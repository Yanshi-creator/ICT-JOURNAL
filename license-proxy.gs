/**
 * WINDAGE LICENSE PROXY (optional)
 * Only needed if activating a license key in Windage says it "couldn't reach the payment service".
 * It passes the license check to Dodo Payments from Google's servers instead of the browser.
 * It holds no secrets: Dodo's license endpoints are public.
 *
 * Setup:
 *  1. Go to script.google.com -> New project. Paste this file. Save.
 *  2. Deploy -> New deployment -> type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *  3. Copy the Web app URL and paste it into billing.js as proxyUrl.
 */
function doPost(e) {
  var req = JSON.parse(e.postData.contents || '{}');
  var allowed = ['/licenses/activate', '/licenses/validate'];
  if (allowed.indexOf(req.path) < 0) return json_({ _status: 400, _body: { error: 'Not allowed' } });
  var host = req.mode === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
  var res = UrlFetchApp.fetch(host + req.path, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(req.body || {}), muteHttpExceptions: true,
  });
  var body = null;
  try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
  return json_({ _status: res.getResponseCode(), _body: body });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
