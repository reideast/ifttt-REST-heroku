var express = require('express');
var bodyParser = require('body-parser');
var mongodb = require('mongodb');
var ObjectID = mongodb.ObjectID;

var CONTACTS_COLLECTION = 'contacts';

// TODO: Move to ENV variable
var API_USERS = [
    {
        "username": "deskase",
        "key": "abcde12345",
        "IFTTT_KEY": "SECRET"
    }
];


var app = express();
app.use(bodyParser.json());

// Create link to Angular build dir dist/
var distDir = __dirname + '/dist/';
app.use(express.static(distDir));

// Create a database variable outside of the database connection callback to reuse the connection pool in your app.
var db;

// Connect to database before app server starts
mongodb.MongoClient.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/test", function (err, client) {
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
    });
});

// Generic error handler used by all endpoints.
function handleError(res, reason, message, code) {
    console.log("ERROR " + code + ": '" + reason + "', Message: '" + message + "'");
    res.status(code || 500).json({"error": message});
}

// IFTTT API ROUTES

// IFTTT Shopping List AND Parser
app.post("/api/ifttt/shopping/and", function (req, res) {
    console.log("********************");
    console.log(req.body);
    console.log("username:");
    console.log(req.body.username);
    console.log("key:");
    console.log(req.body.key);
    console.log("shoppingItems:");
    console.log(req.body.shoppingItems);
    console.log("********************");
    if (!req.body.username) {
        handleError(res, "Invalid input: Missing username", "Must provide 'username'", 400);
    } else {
        if (!req.body.key) {
            handleError(res, "Invalid input: Missing key", "Must provide a user's 'key'", 400);
        } else {
            var userIftttKey = authenticate(req.body.username, req.body.key);
            if (!userIftttKey) {
                handleError(res, "Unknown username and key", "The provided username and key were not valid", 401);
            } else {
                if (!req.body.shoppingItems) {
                    handleError(res, "Invalid input: Missing shoppingItems", "Must provide data in the 'shoppingItems' for this API endpoint", 400);
                } else {
                    var shoppingItems = req.body.shoppingItems;

                    res.status(200).json(shoppingItems);
                }
            }
        }
    }
});

// CONTACTS API ROUTES BELOW

/*  "/api/contacts"
 *    GET: finds all contacts
 *    POST: creates a new contact
 */

app.get("/api/contacts", function(req, res) {
    db.collection(CONTACTS_COLLECTION).find({}).toArray(function(err, docs) {
        if (err) {
            handleError(res, err.message, "Failed to get contacts.");
        } else {
            res.status(200).json(docs);
        }
    });
});

app.post("/api/contacts", function(req, res) {
    var newContact = req.body;
    newContact.createDate = new Date();

    if (!req.body.name) {
        handleError(res, "Invalid user input", "Must provide a name.", 400);
    }

    db.collection(CONTACTS_COLLECTION).insertOne(newContact, function(err, doc) {
        if (err) {
            handleError(res, err.message, "Failed to create new contact.");
        } else {
            res.status(201).json(doc.ops[0]);
        }
    });
});

/*  "/api/contacts/:id"
 *    GET: find contact by id
 *    PUT: update contact by id
 *    DELETE: deletes contact by id
 */

app.get("/api/contacts/:id", function(req, res) {
    db.collection(CONTACTS_COLLECTION).findOne({ _id: new ObjectID(req.params.id) }, function(err, doc) {
        if (err) {
            handleError(res, err.message, "Failed to get contact");
        } else {
            res.status(200).json(doc);
        }
    });
});

app.put("/api/contacts/:id", function(req, res) {
    var updateDoc = req.body;
    delete updateDoc._id;

    db.collection(CONTACTS_COLLECTION).updateOne({_id: new ObjectID(req.params.id)}, updateDoc, function(err, doc) {
        if (err) {
            handleError(res, err.message, "Failed to update contact");
        } else {
            updateDoc._id = req.params.id;
            res.status(200).json(updateDoc);
        }
    });
});

app.delete("/api/contacts/:id", function(req, res) {
    db.collection(CONTACTS_COLLECTION).deleteOne({_id: new ObjectID(req.params.id)}, function(err, result) {
        if (err) {
            handleError(res, err.message, "Failed to delete contact");
        } else {
            res.status(200).json(req.params.id);
        }
    });
});
