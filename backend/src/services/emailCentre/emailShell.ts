// The DNA email shell: one reusable, email-client-safe layout shared by every
// Email Centre email. Visual source of truth: the DnA welcome email
// (db/schema.ts welcome template) — #222 backdrop, lime frame, off-white "paper"
// with a dot pattern, monospace `iit_kanpur` label, "Get creative." footer.
//
// Email-client rules followed here: tables for structure (no flex/grid), inline
// CSS for everything critical, web-safe font stack, and every decorative extra
// (dot pattern, rounded corners, shadows) degrades to a clean flat colour. The
// one <style> block only adds a mobile refinement; the email is fully styled
// without it (some clients strip <style>).

export const DNA_COLORS = {
  backdrop: '#222222',
  frame: '#dced3e',
  paper: '#f4f4f0',
  ink: '#111111',
  inkSoft: '#333333',
  highlight: '#e0f55b',
  cta: '#e64298',
} as const;

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";

const MOBILE_CSS = `
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  @media only screen and (max-width: 520px) {
    .dna-outer { padding: 16px 8px !important; }
    .dna-frame { padding: 12px 12px 28px 12px !important; }
    .dna-paper { padding: 28px 20px !important; }
    .dna-h1 { font-size: 34px !important; }
    .dna-h2 { font-size: 24px !important; }
    .dna-tagline { font-size: 28px !important; }
  }
`;

/** Wraps rendered body HTML (from the engine) in the DNA layout and returns a complete document. */
export function dnaShell(bodyHtml: string, opts: { banner?: string; title?: string } = {}): string {
  const title = (opts.title ?? 'DnA Club').replace(/[<>&"]/g, '');
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${title}</title>
<style>${MOBILE_CSS}</style>
</head>
<body style="margin:0;padding:0;background-color:${DNA_COLORS.backdrop};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${DNA_COLORS.backdrop}" style="background-color:${DNA_COLORS.backdrop};margin:0;padding:0;">
  <tr>
    <td align="center" class="dna-outer" style="padding:40px 20px;">
      <!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
        <tr>
          <td class="dna-frame" bgcolor="${DNA_COLORS.frame}" style="background-color:${DNA_COLORS.frame};padding:20px 20px 40px 20px;border-radius:8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="dna-paper" bgcolor="${DNA_COLORS.paper}" style="background-color:${DNA_COLORS.paper};background-image:radial-gradient(#aaaaaa 1px, transparent 1px);background-size:20px 20px;padding:45px 35px;font-family:${FONT};color:${DNA_COLORS.inkSoft};text-align:left;">
                  <div style="font-family:${MONO};font-size:16px;border-bottom:1.5px solid ${DNA_COLORS.backdrop};display:inline-block;margin:0 0 35px 0;color:${DNA_COLORS.backdrop};text-transform:lowercase;">iit_kanpur</div>
                  ${opts.banner ?? ''}
                  ${bodyHtml}
                </td>
              </tr>
            </table>
            <div class="dna-tagline" style="margin-top:25px;font-size:35px;font-weight:800;color:${DNA_COLORS.ink};text-align:center;letter-spacing:-1px;font-family:${FONT};">Get creative.</div>
            <div style="text-align:center;color:#000000;font-size:12px;margin-top:20px;font-weight:500;letter-spacing:0.5px;font-family:${FONT};">designed by venugopal</div>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
