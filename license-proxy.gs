/**
 * WINDAGE LICENSE PROXY (optional)
 * Only needed if activating a license key in Windage says it "couldn't reach the payment service".
 * It passes the license check to Gumroad from Google's servers instead of the browser.
 * It holds no secrets: Gumroad's license check is public.
 *
 * Setup:
 *  1. Go to script.google.com -> New project. Paste this file. Save.
 *  2. Deploy -> New deployment -> type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *  3. Copy the Web app URL and paste it into billing.js as proxyUrl.
 */
function doPost(e) {
  var req = JSON.parse(e.postData.contents || '{}');
  if (!req.product_id || !req.license_key) return json_({ _status: 400, _body: { success: false } });
  var res = UrlFetchApp.fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'post',
    payload: {
      product_id: String(req.product_id),
      license_key: String(req.license_key),
      increment_uses_count: req.increment_uses_count === 'true' ? 'true' : 'false',
    },
    muteHttpExceptions: true,
  });
  var body = null;
  try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
  return json_({ _status: res.getResponseCode(), _body: body });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
