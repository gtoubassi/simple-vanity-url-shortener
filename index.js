
const GoogleSpreadsheet = require('google-spreadsheet');

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

exports.handler = (event, context, callback) => {
  const spreadsheet = new GoogleSpreadsheet(process.env.SHEET_ID); // Sheet ID (visible in URL)

  var creds = {
    client_email: process.env.SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.SERVICE_ACCOUNT_PK.replace(/\\n/g, "\n"),
  };

  return spreadsheet.useServiceAccountAuth(creds, () => {
    spreadsheet.getInfo((sheetError, info) => {
      if (sheetError) {
        return callback(sheetError);
      }

      const sheet = info.worksheets[0];

      const rowOptions = {
        limit  : 100000,
        offset : 0
      }

      return sheet.getRows(rowOptions, (rowsError, rows) => {
        if (rowsError) {
          return callback(rowsError)
        }
        
        var target = event.path.substring(1); // remove leading slash
        var matches = rows.filter((row) => {return row.vanitypath == target;});
        
        if (matches.length == 0) {
          return callback(null, httpResponse(404, "No matches", null));
        }
        if (matches.length > 1) {
          return callback(null, httpResponse(404, "Multiple matches", null));
        }
        
        return callback(null, httpResponse(302, null, matches[0].destinationurl))
      });
    });
  });
};

