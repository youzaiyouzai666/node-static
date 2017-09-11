var fs = require('fs');
fs.readFile('./aa.text', function(err, buf){
	if(err){
		console.log(err);
		return;
	}
	console.log(buf.toString())
})