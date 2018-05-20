var express = require('express');
var bodyParser = require('body-parser');
var mongodb = require('mongodb');
var ObjectID = mongodb.ObjectID;
var request = require('request');

var CONTACTS_COLLECTION = 'contacts';

/** Usernames and their API keys are stored in the Heroku Config Vars
 * Config Var name: API_USERS
 * schema: Array:
 * [
 *     {
 *          "username": "username",
 *          "key": "their api key for this service",
 *          "IFTTT_KEY": "ifttt webhooks api key for this user"
 *     },
 *     ...
 * ]
 */
var API_USERS = JSON.parse(process.env.API_USERS) || [];

var IFTTT_EVENT_NAME = 'list-shopping-return';
var URL_BASE = "https://maker.ifttt.com/trigger/" + IFTTT_EVENT_NAME + "/with/key/"; // + "IFTTT API key"


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

/**
 * Helper function to authenticate users against API_USERS
 * @param username String user identifier
 * @param key String That user's API key
 * @return String That user's IFTTT_KEY, or {null} if not valid
 */
function authenticate(username, key) {
    var found = API_USERS.find(function (elem) {
        return elem.username === username && elem.key === key;
    });
    if (found) {
        return found.IFTTT_KEY;
    } else {
        return null;
    }
}

// IFTTT Shopping List AND Parser
app.post("/api/ifttt/shopping/and", function (req, res) {
    console.log("********************");
    console.log(req.body);
    console.log("********************");
    if (!req.body.shoppingItems) {
        handleError(res, "Invalid input: Missing shoppingItems", "Must provide data in the 'shoppingItems' for this API endpoint", 400);
    } else {
        if (!req.body.username) {
            handleError(res, "Invalid input: Missing username", "Must provide 'username'", 400);
        } else {
            if (!req.body.key) {
                handleError(res, "Invalid input: Missing key", "Must provide a user's 'key'", 400);
            } else {
                var userIftttKey = authenticate(req.body.username, req.body.key);
                console.log("Authentication finished. Found user's IFTTT API key: " + userIftttKey);
                if (!userIftttKey) {
                    handleError(res, "Unknown username and key", "The provided username and key were not valid", 401);
                } else {
                    // Parse shoppingItems into an array of strings, each split on "AND"
                    var items = splitOnAnd(req.body.shoppingItems);

                    items.forEach(function (item) {
                        var tags = ""; // TODO: Optional Trello Tags
                        var itemJson = { // IFTTT JSON Format: Value1,2,3
                            value1: item, // Text of the Trello card
                            value2: "ParsedByApi, " + tags,
                            value3: ""
                        };
                        console.log("About to send: ", itemJson);

                        request({
                            url: URL_BASE + userIftttKey,
                            method: "POST",
                            json: true,
                            body: itemJson
                        }, function (err, subResponse, body) {
                            if (err) {
                                console.log("ERROR " + subResponse.statusCode + " while sending request for shopping item: ", itemJson);
                                console.log(err);
                            } else {
                                console.log("Request successful: " + subResponse.statusCode + " " + subResponse.statusMessage + ": " + body);
                            }
                        });
                    });

                    res.status(200).json({items: items});
                }
            }
        }
    }
});

/**
 * Split a string on each and/AND found
 * @param str String Text that may contain the word and/AND
 * @return Array An list of items split
 */
function splitOnAnd(str) {
    var phrases = [];
    if (str) { // Protects against null, undefined, and ""
        var words = str.split(' ');
        var startOfPhrase = 0;
        words.forEach(function (word, index) {
            if (word.toLowerCase() === 'and') {
                if (index - startOfPhrase > 0) { // multiple ands in a row
                    phrases.push(words.slice(startOfPhrase, index).join(" "));
                }
                startOfPhrase = index + 1;
            }
        });
        if (startOfPhrase < words.length) {
            phrases.push(words.slice(startOfPhrase).join(" "));
        }
    }
    return phrases;
}

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
