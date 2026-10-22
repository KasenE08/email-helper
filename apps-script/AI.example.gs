/**
 * OPTIONAL: AI card summaries with the Gemini API free tier.
 * Not part of the bundle. To use it, see "Plugging in AI summaries" in the README:
 *   1. Paste this file into Apps Script as AI.gs.
 *   2. Script Properties: add GEMINI_API_KEY (get a free key at https://aistudio.google.com).
 *   3. appsscript.json: add "https://www.googleapis.com/auth/script.external_request" to oauthScopes.
 *   4. Config.gs: set AI_SUMMARIES: true. Save, then Deploy → Manage deployments → New version.
 *      The next Refresh re-reads every email with AI summaries (changing Config triggers that).
 *
 * Privacy note: this sends each new email's subject + text to Google's Gemini API.
 * On the free tier Google may use that data to improve its products.
 */

// Copy a current model name from AI Studio if this one is retired.
var AI_MODEL = 'gemini-flash-latest';

/** Must return a short string (one or two sentences). Errors fall back to the normal snippet. */
function aiSummarize_(email) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return null;
  var text = (email.subject || '') + '\n\n' + String(email.body || email.snippet || '').slice(0, 4000);
  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + AI_MODEL + ':generateContent',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text:
          'Summarize this email for a busy student in ONE short sentence (max 25 words). ' +
          'Lead with what they need to do and by when, if anything. No preamble.\n\n' + text }] }],
        generationConfig: { maxOutputTokens: 80, temperature: 0.2 },
      }),
    }
  );
  if (res.getResponseCode() !== 200) throw new Error('Gemini ' + res.getResponseCode());
  var data = JSON.parse(res.getContentText());
  return data.candidates && data.candidates[0] && data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim();
}
