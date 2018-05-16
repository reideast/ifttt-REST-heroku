var express = require('express');
var bodyParser = require('body-parser');
var mongodb = require('mongodb');
var ObjectID = mongodb.ObjectId;

var CONTACTS_COLLECTION = 'contacts';

var app = express();
app.use(bodyParser.json());

// Create a database variable outside of the database connection callback to reuse the connection pool in your app.
var db;

// Connect to database before app server starts
mongodb.MongoClient.connect(process.env.MONGODB_URI) || "mongodb://localhost:27017/test", function (err, client) {
    if (err) {
        console.log(err);
        process.exit(1);
    }

    // save db object for use once the callback finishes
    db = client.db();
    console.log("DB connection ready");

    // Now, start the app
    var server = app.listen(process.env.PORT || 8080, function () {
        var port = server.address().port;
        console.log("App now running on port:", port);
    })
}
