const { GoogleSpreadsheet } = require('google-spreadsheet');

function httpResponse(status, body, location) {
  var response = {statusCode: status, headers: {}};
  
  if (location) {
    response.headers['location'] = location;
  }
  if (body) {
    response.body = body;
    response.headers['Content-Type'] = "text/html";
  }

  response.headers['Cache-Control'] = 'private, no-cache, no-store, must-revalidate';
  response.headers['Expires'] = '-1';
  response.headers['Pragma'] = 'no-cache';

  return response;
}

exports.handler = async (event, context, callback) => {
  const spreadsheet = new GoogleSpreadsheet(process.env.SHEET_ID); // Sheet ID (visible in URL)

  var creds = {
    client_email: process.env.SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.SERVICE_ACCOUNT_PK.replace(/\\n/g, "\n"),
  };

  await spreadsheet.useServiceAccountAuth(creds);
  await spreadsheet.loadInfo();
  const sheet = spreadsheet.sheetsByIndex[0];

  const rowOptions = {
    limit  : 100000,
    offset : 0
  }
  
  const rows = await sheet.getRows(rowOptions);
  
  var target = event.path.substring(1); // remove leading slash
  var matches = rows.filter((row) => {return row['Vanity Path'] == target;});

  if (matches.length == 0) {
    if (process.env.NO_MATCH_REDIR_URL) {
      return callback(null, httpResponse(302, null, process.env.NO_MATCH_REDIR_URL.replace(/SHORTURL/g, target)));
    }
    else {
      return callback(null, httpResponse(404, "No match for " + target, null));
    }
  }
  if (matches.length > 1) {
    return callback(null, httpResponse(404, "Multiple matches", null));
  }
  
  return callback(null, httpResponse(302, null, matches[0]['Destination URL']))
};

