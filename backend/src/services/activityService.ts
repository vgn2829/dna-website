import { pool } from '../db/client';

const MIN_BATCH_YEAR = 20;
const MAX_BATCH_YEAR = 30;

/**
 * Single source of truth for deriving a student's batch from their roll number.
 * Roll numbers at IIT Kanpur start with admission year digits (e.g. 260012 -> Y26).
 */
export function deriveBatch(rollNumber: string): string {
  const digits = rollNumber.trim().slice(0, 2);
  const yearNum = Number(digits);
  return yearNum >= MIN_BATCH_YEAR && yearNum <= MAX_BATCH_YEAR ? `Y${digits}` : 'Other';
}

export interface ActivityBreakdown {
  recencyScore: number;
  loginScore: number;
  rsvpScore: number;
  sessionScore: number;
  learningScore: number;
  daysSinceLastLogin: number | null;
}

export interface TargetCandidate {
  rollNumber: string;
  name: string | null;
  email: string;
  batch: string;
  activityScore: number;
  breakdown: ActivityBreakdown;
  lastLogin: string | null;
  registeredAt: string;
}

export interface RecipientSelectionOptions {
  audienceType: 'all' | 'registered' | 'active';
  batch?: string | null; // e.g. 'Y26', 'Y25', or null/'ALL' for all batches
  limit?: number;
  eventId?: string; // target event ID (if audienceType === 'registered' or for event scope)
  excludeEventIds?: string[];
  excludeCampaignIds?: string[];
}

export interface RecipientSelectionResult {
  totalEligible: number;
  candidates: TargetCandidate[];
}

/**
 * Fetch available dynamic batches from existing student roll numbers.
 */
export async function getAvailableBatches(): Promise<string[]> {
  const rows = await pool.query<{ roll_number: string }>('SELECT roll_number FROM student_sessions WHERE email IS NOT NULL');
  const set = new Set<string>();
  for (const r of rows.rows) {
    set.add(deriveBatch(r.roll_number));
  }
  return Array.from(set).sort();
}

/**
 * Centralized activity selection and ranking engine.
 * Computes Activity Score deterministically using explicit time windows and caps.
 */
export async function selectTargetRecipients(options: RecipientSelectionOptions): Promise<RecipientSelectionResult> {
  const {
    audienceType = 'all',
    batch = null,
    limit = 50,
    eventId = null,
    excludeEventIds = [],
    excludeCampaignIds = [],
  } = options;

  // Build exclusion lists
  const excludeEventList = (excludeEventIds || []).filter(Boolean);
  const excludeCampaignList = (excludeCampaignIds || []).filter(Boolean);

  let whereClauses: string[] = ['ss.email IS NOT NULL'];
  const queryParams: any[] = [];
  let paramIdx = 1;

  // Audience filtering
  if (audienceType === 'registered' && eventId) {
    queryParams.push(eventId);
    whereClauses.push(`ss.roll_number IN (SELECT roll_number FROM event_rsvps WHERE event_id = $${paramIdx++})`);
  }

  // Batch filtering
  if (batch && batch !== 'ALL' && batch !== 'all') {
    if (batch === 'Other') {
      whereClauses.push(`(
        SUBSTRING(ss.roll_number FROM 1 FOR 2)::int < ${MIN_BATCH_YEAR} OR
        SUBSTRING(ss.roll_number FROM 1 FOR 2)::int > ${MAX_BATCH_YEAR} OR
        ss.roll_number !~ '^[0-9]'
      )`);
    } else {
      const yearDigits = batch.replace(/^Y/i, '');
      queryParams.push(yearDigits);
      whereClauses.push(`SUBSTRING(ss.roll_number FROM 1 FOR 2) = $${paramIdx++}`);
    }
  }

  // Deduplication Exclusions:
  // Exclude students who have been successfully sent, delivered, bounced, or suppressed for specified events
  if (excludeEventList.length > 0) {
    const placeholders = excludeEventList.map(() => `$${paramIdx++}`).join(', ');
    queryParams.push(...excludeEventList);
    whereClauses.push(`ss.roll_number NOT IN (
      SELECT roll_number FROM email_recipients
      WHERE event_id IN (${placeholders})
        AND status IN ('sent', 'delivered', 'bounced', 'suppressed')
    )`);
  }

  // Exclude students contacted in specified campaigns
  if (excludeCampaignList.length > 0) {
    const placeholders = excludeCampaignList.map(() => `$${paramIdx++}`).join(', ');
    queryParams.push(...excludeCampaignList);
    whereClauses.push(`ss.roll_number NOT IN (
      SELECT roll_number FROM email_recipients
      WHERE campaign_id IN (${placeholders})
        AND status IN ('sent', 'delivered', 'bounced', 'suppressed')
    )`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // SQL Query computing score components with strict time windows:
  // 1. Recency: 30-day window on last_login (30 - days, capped 0..30 * 3) -> max 90 pts
  // 2. Login Freq: 30-day window on login_events (count * 2, capped 60 pts) -> max 60 pts
  // 3. Event RSVPs: 90-day window on event_rsvps (count * 5, capped 50 pts) -> max 50 pts
  // 4. Live Sessions: 90-day window on session_joins (count * 3, capped 30 pts) -> max 30 pts
  // 5. Learning: 90-day window / total watched videos + completed quizzes (count * 2, capped 30 pts) -> max 30 pts
  const sql = `
    WITH ranked_users AS (
      SELECT
        ss.roll_number,
        ss.name,
        ss.email,
        ss.last_login,
        ss.registered_at,
        CASE
          WHEN ss.last_login IS NULL THEN NULL
          ELSE GREATEST(0, EXTRACT(DAY FROM (NOW() - ss.last_login))::int)
        END AS days_since_last_login,

        -- 1. Recency score (max 90)
        CASE
          WHEN ss.last_login IS NULL THEN 0
          ELSE LEAST(90, GREATEST(0, (30 - EXTRACT(DAY FROM (NOW() - ss.last_login))::int) * 3))
        END AS recency_score,

        -- 2. 30-day login frequency score (max 60)
        LEAST(60, (
          SELECT COUNT(*)::int * 2
          FROM login_events le
          WHERE le.roll_number = ss.roll_number
            AND le.logged_in_at >= NOW() - INTERVAL '30 days'
        )) AS login_score,

        -- 3. 90-day RSVP activity score (max 50)
        LEAST(50, (
          SELECT COUNT(*)::int * 5
          FROM event_rsvps er
          WHERE er.roll_number = ss.roll_number
            AND (er.created_at IS NULL OR er.created_at >= NOW() - INTERVAL '90 days')
        )) AS rsvp_score,

        -- 4. 90-day live session joins score (max 30)
        LEAST(30, (
          SELECT COUNT(*)::int * 3
          FROM session_joins sj
          WHERE sj.roll_number = ss.roll_number
            AND (sj.joined_at::timestamptz >= NOW() - INTERVAL '90 days')
        )) AS session_score,

        -- 5. Learning activity score (max 30)
        LEAST(30, (
          (SELECT COUNT(*)::int FROM student_watched_videos vw WHERE vw.roll_number = ss.roll_number) +
          (SELECT COUNT(*)::int FROM student_completed_quizzes cq WHERE cq.roll_number = ss.roll_number)
        ) * 2) AS learning_score

      FROM student_sessions ss
      ${whereSql}
    )
    SELECT
      roll_number,
      name,
      email,
      last_login,
      registered_at,
      days_since_last_login,
      recency_score,
      login_score,
      rsvp_score,
      session_score,
      learning_score,
      (recency_score + login_score + rsvp_score + session_score + learning_score)::int AS total_score,
      COUNT(*) OVER()::int AS total_eligible_count
    FROM ranked_users
    ORDER BY
      total_score DESC,
      last_login DESC NULLS LAST,
      registered_at DESC,
      roll_number ASC
  `;

  const result = await pool.query(sql, queryParams);
  const rows = result.rows;
  const totalEligible = rows.length > 0 ? rows[0].total_eligible_count : 0;

  const candidateLimit = Math.max(1, limit);
  const selectedRows = rows.slice(0, candidateLimit);

  const candidates: TargetCandidate[] = selectedRows.map((r) => ({
    rollNumber: r.roll_number,
    name: r.name,
    email: r.email,
    batch: deriveBatch(r.roll_number),
    activityScore: r.total_score,
    breakdown: {
      recencyScore: r.recency_score,
      loginScore: r.login_score,
      rsvpScore: r.rsvp_score,
      sessionScore: r.session_score,
      learningScore: r.learning_score,
      daysSinceLastLogin: r.days_since_last_login,
    },
    lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null,
    registeredAt: r.registered_at,
  }));

  return {
    totalEligible,
    candidates,
  };
}
