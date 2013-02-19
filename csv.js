// adapted from https://github.com/voodootikigod/node-csv/blob/master/lib/csv.js

// CSV parser for node.js that handles all standard CSV parsing and 
// returns the data elements in a single 'data' event emmitter. 
// Currently the only exported function is each(filename, option),
// where filename is the file to process and options can have any 
// of the following:
//
//    strDelimiter: The string to use for delimiting data elements.
//    headers:      If the first line of the file represents headers. 
//                  Setting this will convert the translated array into
//                  an object with the headers as attributes and the
//                  values assigned. 
//    readAmount:   Number of bytes to read before parsing and processing.
//
//
//
//
var fs = require("fs"),
  sys = require("sys"),
  events = require("events");


// CSVToArray Parsing function from http://www.bennadel.com/blog/1504-Ask-Ben-Parsing-CSV-Strings-With-Javascript-Exec-Regular-Expression-Command.htm
// This will parse a delimited string into an array of
// arrays. The default delimiter is the comma, but this
// can be overriden in the second argument.
function CSVToArray( strData, strDelimiter ){
	// Check to see if the delimiter is defined. If not,
	// then default to comma.
	strDelimiter = (strDelimiter || ",");

	// Create a regular expression to parse the CSV values.
	var objPattern = new RegExp(
		(
			// Delimiters.
			"(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +

			// Quoted fields.
			"(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +

			// Standard fields.
			"([^\"\\" + strDelimiter + "\\r\\n]*))"
		),
		"gi"
		);


	// Create an array to hold our data. Give the array
	// a default empty first row.
	var arrData = [[]];
	// Create an array to hold our individual pattern
	// matching groups.
	var arrMatches = null;
	// Keep looping over the regular expression matches
	// until we can no longer find a match.
	while (arrMatches = objPattern.exec( strData )){
		// Get the delimiter that was found.
		var strMatchedDelimiter = arrMatches[ 1 ];
		// Check to see if the given delimiter has a length
		// (is not the start of string) and if it matches
		// field delimiter. If id does not, then we know
		// that this delimiter is a row delimiter.
		if (
			strMatchedDelimiter.length &&
			(strMatchedDelimiter != strDelimiter)
			){

			// Since we have reached a new row of data,
			// add an empty row to our data array.
			arrData.push( [] );
		}


		// Now that we have our delimiter out of the way,
		// let's check to see which kind of value we
		// captured (quoted or unquoted).
		if (arrMatches[ 2 ]){

			// We found a quoted value. When we capture
			// this value, unescape any double quotes.
			var strMatchedValue = arrMatches[ 2 ].replace(
				new RegExp( "\"\"", "g" ),
				"\""
				);

		} else {

			// We found a non-quoted value.
			var strMatchedValue = arrMatches[ 3 ];

		}


		// Now that we have our value string, let's add
		// it to the data array.
		arrData[ arrData.length - 1 ].push( strMatchedValue );
	}

	// Return the parsed data.
	return( arrData );
}

exports.parse = function(str, delim, headers) {
	var a = CSVToArray(str, delim)
	if (a[a.length - 1].length != a[0].length) a.pop()
	if (headers) {
		headers = a[0]
		var b = []
		for (var i = 1; i < a.length; i++) {
			var o = {}
			a[i].forEach(function (v, i) { o[headers[i]] = v })
			b.push(o)
		}
		a = b
	}
	return a
}
