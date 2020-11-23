const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const sanitizer = require('sanitize')();

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
const API_USERS = JSON.parse(process.env.API_USERS) || [];

const IFTTT_EVENT_NAME = 'list-shopping-return';
const URL_BASE = "https://maker.ifttt.com/trigger/" + IFTTT_EVENT_NAME + "/with/key/"; // + "IFTTT API key"

/**
 * An artificial delay between each outgoing request to IFTTT WebHooks.
 * An attempt to be polite to the IFTTT maker endpoints (and to not get rate-limited).
 * @type {number}
 */
const OUTGOING_REQUEST_DELAY = 10000;


const app = express();
app.use(bodyParser.json());

// Create link to Angular build dir dist/
const distDir = __dirname + '/dist/';
app.use(express.static(distDir));

// Start the app server
const server = app.listen(process.env.PORT || 8080, function () {
    const port = server.address().port;
    console.log("App now running on port:", port);
});

// Generic error handler used by all endpoints.
function handleError(res, reason, message, code) {
    console.log("ERROR " + code + ": '" + reason + "', Message: '" + message + "'");
    res.status(code || 500).json({"error": message});
}

// IFTTT API ROUTES

/**
 * Helper function to authenticate users against API_USERS
 * @param username {string} user identifier
 * @param key {string} That user's API key
 * @return {string|null} That user's IFTTT_KEY, or {null} if not valid
 */
function authenticate(username, key) {
    const found = API_USERS.find(function (elem) {
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
                const userIftttKey = authenticate(req.body.username, req.body.key);
                console.log("Authentication finished. Found user's IFTTT API key: " + userIftttKey);
                if (!userIftttKey) {
                    handleError(res, "Unknown username and key", "The provided username and key were not valid", 401);
                } else {
                    // Parse shoppingItems into an array of strings, each split on "AND"
                    const shoppingItems = sanitizer.value(req.body.shoppingItems, 'str');
                    const items = splitOnAnd(shoppingItems);

                    // TODO: wait an increasing number of seconds between each of these items in the forEach
                    items.forEach(function(item) {
                      processItem(item, userIftttKey);
                    });

                    res.status(200).json({items: items});
                }
            }
        }
    }
});

/**
 * Send a request to the IFTTT service to save a single item to the Trello shopping list
 * @param item (string) The item to send to Trello
 * @param userIftttKey (string) An IFTTT user's API key. Identifies the user to the IFTTT service. Sent in POST URL
 */
function processItem(item, userIftttKey) {
  const trelloLabels = searchGroceryTags(item); // Optional Trello Tags/Labels
  const jsonPayload = { // IFTTT JSON Format: Value1,2,3
    value1: item, // Text of the Trello card
    value2: trelloLabels,
    value3: ""
  };
  console.log("About to send: ", jsonPayload);

  console.log("DEBUG: Adding " + item + " to the delay queue");
  addItemToQueue({jsonPayload: jsonPayload, userIftttKey: userIftttKey});
}

/**
 * Return a delay in milliseconds that a request should wait.
 * Provides a simple queueing mechanism, just to prevent too many requests from going at once.
 * For this to work, there must ALWAYS be a delay, even for the first item. Else, each item would immediately send, and then be "dequeued"...meaning the next item would also have no delay
 * @return (number) Minimum number of milliseconds to wait to request to ensure this item will be sent at minimum OUTGOING_REQUEST_DELAY after any others
 * NOTE: Side effect: updates itemsQueueToBeSent, essentially "enqueuing" one item
 */
// function getRequestBasedOnCurrentQueue() {
//   return itemsQueuedToBeSent * OUTGOING_REQUEST_DELAY;
// }
function addItemToQueue(payloadAndKey) {
  itemsQueuedToBeSent += 1;
  console.log("DEBUG: One should have been enqueued: " + itemsQueuedToBeSent);

  sendQueue.push(payloadAndKey);
  console.log(sendQueue);

  if (timeoutHandle === null) {
    timeoutHandle = setTimeout(processOneItemOrStopProcessing, OUTGOING_REQUEST_DELAY);
  } // else, the timeout is already going, and will keep repeating as long as there are items to be dequeued
}
// function removeItemFromQueue() {
//   itemsQueuedToBeSent -= 1;
//   console.log("DEBUG: Dequeued. Queue length is now " + itemsQueuedToBeSent);
// }
let itemsQueuedToBeSent = 0;
let sendQueue = [];
let timeoutHandle = null;

function processOneItemOrStopProcessing() {
  if (sendQueue.length === 0) {
    timeoutHandle = null;
    console.log("Timeout processing done. Queue is empty");
  } else {
    // const [jsonPayload, userIftttKey] = queue.shift();
    const payloadAndKey = sendQueue.shift();
    itemsQueuedToBeSent -= 1;
    console.log("Sending payload:");
    console.log(payloadAndKey.jsonPayload);
    console.log("And now queue is:");
    console.log(sendQueue);
    request({
      url: URL_BASE + payloadAndKey.userIftttKey,
      method: "POST",
      json: true,
      body: payloadAndKey.jsonPayload
    }, function (err, subResponse, body) {
      if (err) {
        console.log("ERROR " + subResponse.statusCode + " while sending request for shopping item: ", payloadAndKey.jsonPayload);
        console.log(err);
      } else {
        console.log("Request successful: " + subResponse.statusCode + " " + subResponse.statusMessage + ": " + body);
      }
    });

    // Repeat the processing. Note: repeat even if there are none left in the queue. This feels like a guard against a race condition on enqueuing one item and then starting a new timeout, but node.js is single-threaded so that really isn't a think. This isn't even the right way to do it if this was multi-threaded code...
    timeoutHandle = setTimeout(processOneItemOrStopProcessing, OUTGOING_REQUEST_DELAY);
    console.log("Item finished, starting a new wait");
  }
}

/**
 * Split a string on each and/AND found
 * @param str {string} Text that may contain the word and/AND
 * @return {array} An list of items split
 */
function splitOnAnd(str) {
    const phrases = [];
    if (str) { // Protects against null, undefined, and ""
        const words = str.split(' ');
        let startOfPhrase = 0;
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

/**
 * Intelligently assign tags to a grocery shopping item
 * @param item {string} The grocery item to examine
 * @return {string} A comma-separated list of tags, or "" if none identified
 */
function searchGroceryTags(item) {
    item = item.toLowerCase();
    const tags = [];
    if (item.indexOf('milk') !== -1) {
        tags.push(TRELLO_TAGS.refrig)
    }
    if (item.indexOf('cream') !== -1) {
        tags.push(TRELLO_TAGS.refrig)
    }
    if (item.indexOf('cheese') !== -1) {
        tags.push(TRELLO_TAGS.refrig)
    }
    if (item.indexOf('walnut') !== -1) {
        tags.push(TRELLO_TAGS.pantry)
    }
    if (item.indexOf('pepperoni') !== -1) {
        tags.push(TRELLO_TAGS.refrig)
    }
    if (item.indexOf('tortillas') !== -1) {
        tags.push(TRELLO_TAGS.pantry)
    }
    if (item.indexOf('lettuce') !== -1) {
        tags.push(TRELLO_TAGS.produce)
    }
    if (item.indexOf('bread') !== -1) {
        tags.push(TRELLO_TAGS.pantry)
    }
    if (item.indexOf('chicken') !== -1) {
        tags.push(TRELLO_TAGS.refrig)
    }
    if (item.indexOf('muffin') !== -1) {
        tags.push(TRELLO_TAGS.pantry)
    }
    if (item.indexOf('peanut') !== -1) {
        tags.push(TRELLO_TAGS.pantry)
    }
    return tags.join(',');
}
const TRELLO_TAGS = {
    produce: 'Produce',
    refrig: 'Frozen Refrigerated Dairy',
    pantry: 'Dry Goods',
    cleaningSupplies: 'Home Goods',
    pets: 'Pet Store',
    clothes: 'Clothes',
    hardware: 'Hardware Store',
    hipster: 'Local Market',
    discount: 'Euro Store',
    personal: 'Personal Care'
};
