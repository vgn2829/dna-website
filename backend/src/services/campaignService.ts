import { pool } from '../db/client';
import { Resend } from 'resend';
import { selectTargetRecipients, RecipientSelectionOptions, TargetCandidate } from './activityService';
import { broadcastBudgetRemaining, MAIL_FROM } from './mailer';

export interface CampaignDetails {
  title: string;
  subject: string;
  html: string;
  adminUser?: string;
}

export interface QuotaStatus {
  dailyQuota: number;
  sentToday: number;
  remainingToday: number;
  otpReserve: number;
  broadcastBudget: number;
  willExceed: boolean;
  sentNowCount: number;
  queuedCount: number;
}

export interface CampaignPreviewResult {
  totalEligible: number;
  requestedLimit: number;
  candidates: TargetCandidate[];
  quotaStatus: QuotaStatus;
}

const DAILY_QUOTA = 100;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Read-only recalculation of campaign targets & quota status without mutating state.
 */
export async function getCampaignPreview(
  options: RecipientSelectionOptions
): Promise<CampaignPreviewResult> {
  const { totalEligible, candidates } = await selectTargetRecipients(options);
  const broadcastBudget = await broadcastBudgetRemaining();

  const requestedLimit = Math.max(1, options.limit || 50);
  const targetCount = candidates.length;
  const sentNowCount = Math.min(targetCount, broadcastBudget);
  const queuedCount = Math.max(0, targetCount - sentNowCount);
  const willExceed = targetCount > broadcastBudget;

  const usageRows = await pool.query<{ sent_count: number }>(
    'SELECT sent_count FROM mail_usage WHERE day = $1',
    [todayUtc()]
  );
  const sentToday = usageRows.rows[0]?.sent_count ?? 0;

  const quotaStatus: QuotaStatus = {
    dailyQuota: DAILY_QUOTA,
    sentToday,
    remainingToday: Math.max(0, DAILY_QUOTA - sentToday),
    otpReserve: Math.max(5, DAILY_QUOTA - broadcastBudget - sentToday),
    broadcastBudget,
    willExceed,
    sentNowCount,
    queuedCount,
  };

  return {
    totalEligible,
    requestedLimit,
    candidates,
    quotaStatus,
  };
}

/**
 * Dispatch recipient emails via Resend Batch API (or mock in test/dev mode).
 */
async function dispatchCampaignBatch(
  campaignId: string,
  recipients: TargetCandidate[],
  subject: string,
  html: string
): Promise<{ sentCount: number }> {
  if (recipients.length === 0) return { sentCount: 0 };

  const client = resendClient();
  let sentCount = 0;

  // Process in chunks of up to 100 (Resend batch API limit)
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const nowIso = new Date().toISOString();

    if (client) {
      try {
        const batchPayload = chunk.map((r) => ({
          from: MAIL_FROM,
          replyTo: 'designandanimationclub.iitk@gmail.com',
          to: r.email,
          subject,
          html,
        }));

        const response = await client.batch.send(batchPayload);
        const batchData = response.data?.data || [];

        for (let j = 0; j < chunk.length; j++) {
          const r = chunk[j];
          const msgId = batchData[j]?.id || null;

          await pool.query(
            `UPDATE email_recipients
             SET status = 'sent', provider_message_id = $1, sent_at = $2
             WHERE campaign_id = $3 AND roll_number = $4`,
            [msgId, nowIso, campaignId, r.rollNumber]
          );
        }
        sentCount += chunk.length;
      } catch (err) {
        console.error(`Resend batch send error for campaign ${campaignId}:`, err);
        // Mark recipients as failed on error
        for (const r of chunk) {
          await pool.query(
            `UPDATE email_recipients
             SET status = 'failed', error_message = $1, failed_at = $2
             WHERE campaign_id = $3 AND roll_number = $4`,
            [err instanceof Error ? err.message : String(err), nowIso, campaignId, r.rollNumber]
          );
        }
      }
    } else {
      // Mock mode (Dev/Test): Simulate successful send without real network calls
      console.log(`[MOCK EMAIL SERVICE] Campaign ${campaignId}: Sending ${chunk.length} emails`);
      for (const r of chunk) {
        const mockMsgId = `mock_msg_${r.rollNumber}_${Date.now()}`;
        await pool.query(
          `UPDATE email_recipients
           SET status = 'sent', provider_message_id = $1, sent_at = $2
           WHERE campaign_id = $3 AND roll_number = $4`,
          [mockMsgId, nowIso, campaignId, r.rollNumber]
        );
      }
      sentCount += chunk.length;
    }
  }

  // Record sent count in mail_usage
  if (sentCount > 0) {
    await pool.query(
      `INSERT INTO mail_usage (day, sent_count) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET sent_count = mail_usage.sent_count + $2`,
      [todayUtc(), sentCount]
    );
  }

  return { sentCount };
}

/**
 * Execute campaign transaction: locks quota row, recalculates targets, logs records, dispatches emails.
 */
export async function createAndExecuteCampaign(
  options: RecipientSelectionOptions,
  campaignDetails: CampaignDetails
): Promise<{ success: boolean; campaignId: string; totalEligible: number; sentNow: number; queued: number }> {
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    // 1. Lock mail_usage row for today to serialize concurrent admin sends
    await dbClient.query(
      'INSERT INTO mail_usage (day, sent_count) VALUES ($1, 0) ON CONFLICT (day) DO NOTHING',
      [todayUtc()]
    );
    await dbClient.query('SELECT sent_count FROM mail_usage WHERE day = $1 FOR UPDATE', [todayUtc()]);

    // 2. Re-calculate budget & target candidates inside transaction
    const broadcastBudget = await broadcastBudgetRemaining();
    const { totalEligible, candidates } = await selectTargetRecipients(options);

    const campaignId = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 3. Create email_campaigns record
    await dbClient.query(
      `INSERT INTO email_campaigns (
        id, event_id, title, subject, audience_type, target_batch, requested_limit,
        excluded_campaign_ids, excluded_event_ids, total_eligible, status, created_by_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sending', $11)`,
      [
        campaignId,
        options.eventId || null,
        campaignDetails.title,
        campaignDetails.subject,
        options.audienceType,
        options.batch || 'ALL',
        options.limit || 50,
        options.excludeCampaignIds || [],
        options.excludeEventIds || [],
        totalEligible,
        campaignDetails.adminUser || 'admin',
      ]
    );

    // 4. Split candidates by quota headroom
    const sendNowCandidates = candidates.slice(0, Math.max(0, broadcastBudget));
    const queuedCandidates = candidates.slice(sendNowCandidates.length);

    const nowIso = new Date().toISOString();

    // 5. Insert initial recipient records
    for (const c of candidates) {
      const isSendNow = sendNowCandidates.includes(c);
      const initialStatus = isSendNow ? 'pending' : 'queued';

      await dbClient.query(
        `INSERT INTO email_recipients (
          campaign_id, event_id, roll_number, email, activity_score, score_breakdown, status, queued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          campaignId,
          options.eventId || null,
          c.rollNumber,
          c.email,
          c.activityScore,
          JSON.stringify(c.breakdown),
          initialStatus,
          isSendNow ? null : nowIso,
        ]
      );
    }

    await dbClient.query('COMMIT');

    // 6. Dispatch emails outside transaction lock (to avoid keeping DB row locks during external network call)
    let actualSentCount = 0;
    if (sendNowCandidates.length > 0) {
      const dispatchResult = await dispatchCampaignBatch(
        campaignId,
        sendNowCandidates,
        campaignDetails.subject,
        campaignDetails.html
      );
      actualSentCount = dispatchResult.sentCount;
    }

    // 7. Final status update on campaign record
    const finalStatus = queuedCandidates.length > 0 ? 'partially_queued' : 'completed';
    await pool.query(
      `UPDATE email_campaigns
       SET sent_count = $1, queued_count = $2, status = $3
       WHERE id = $4`,
      [actualSentCount, queuedCandidates.length, finalStatus, campaignId]
    );

    // 8. Update events.notified_at if eventId is set
    if (options.eventId && actualSentCount > 0) {
      await pool.query('UPDATE events SET notified_at = NOW() WHERE id = $1', [options.eventId]);
    }

    return {
      success: true,
      campaignId,
      totalEligible,
      sentNow: actualSentCount,
      queued: queuedCandidates.length,
    };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

/**
 * Handle incoming Resend delivery webhooks to update recipient delivery state.
 * Validates provider_message_id against stored email_recipients records.
 */
export async function handleResendWebhook(event: {
  type: string;
  data: { email_id?: string; recipient?: string; reason?: string };
}): Promise<boolean> {
  const { type, data } = event;
  if (!data?.email_id) return false;

  const msgId = data.email_id.trim();
  if (!msgId) return false;

  const now = new Date().toISOString();

  if (type === 'email.delivered') {
    const res = await pool.query(
      `UPDATE email_recipients SET status = 'delivered', delivered_at = $1 WHERE provider_message_id = $2 RETURNING id`,
      [now, msgId]
    );
    return (res.rowCount ?? 0) > 0;
  } else if (type === 'email.bounced') {
    const res = await pool.query(
      `UPDATE email_recipients SET status = 'bounced', failed_at = $1, error_message = $2 WHERE provider_message_id = $3 RETURNING id`,
      [now, data.reason || 'Bounced', msgId]
    );
    return (res.rowCount ?? 0) > 0;
  } else if (type === 'email.failed' || type === 'email.suppressed') {
    const status = type === 'email.suppressed' ? 'suppressed' : 'failed';
    const res = await pool.query(
      `UPDATE email_recipients SET status = $1, failed_at = $2, error_message = $3 WHERE provider_message_id = $4 RETURNING id`,
      [status, now, data.reason || 'Failed', msgId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  return false;
}

/**
 * Query past campaigns with event details for admin exclusion dropdowns.
 */
export async function getPastCampaigns(): Promise<
  { id: string; eventId: string | null; eventTitle: string | null; title: string; sentCount: number; createdAt: string }[]
> {
  const result = await pool.query<{
    id: string;
    event_id: string | null;
    event_title: string | null;
    title: string;
    sent_count: number;
    created_at: string;
  }>(`
    SELECT
      c.id,
      c.event_id,
      e.title AS event_title,
      c.title,
      c.sent_count,
      c.created_at
    FROM email_campaigns c
    LEFT JOIN events e ON e.id = c.event_id
    ORDER BY c.created_at DESC
    LIMIT 50
  `);

  return result.rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    eventTitle: r.event_title,
    title: r.title,
    sentCount: r.sent_count,
    createdAt: r.created_at,
  }));
}
