'use strict';

require('dotenv').config(); // hide twitter api

const common_words = require('./common_words.js');
const banned_words = ["cooch", "coochie", "'s", "tseries", "masturbate", "masturbating", "jizz", "shat", "mmm", "owo", "butthole", "weiner", "thot", "haha", "af", "idk", "omg", "uwu", "succ", "thicc", "boi", "jk", "lol", "yeet", "peepee", "pp", "rape", "rapist", "niger", "nig", "dick", "retard", "retarded", "asshole", "shit", "shitty", "shitting", "fuck", "fucking", "fag", "faggot", "tranny", "bitch", "fucker", "cunt", "nigger", "nigga", "slut", "twat", "pussy", "cock", "boner", "motherfucker", "hitler", "nazi", "peen", "penis", "vagina", "clit", "dong", "kike", "pussies", "penises", "bitches", "semen", "dildo", "jewish", "jew", "gay", "ejaculate", "erection", "pennis"];


// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');

admin.initializeApp();

const firestore = admin.firestore();

// Required for checktion dictionary
const unirest = require('unirest');

const points = {
    added_word: 5,
    vote: 1,
    rating: 1,
    high: 10,
    title_chosen: 10,
    logged_in: 5
};

const number_of_recent_words = 10;
const number_of_votes_needed = 2; // To vote words or end votes  out.
const neccesary_title_votes = 5;
const limit = 25; // Number of stories to fetch when producing story queue
const table_limit = 50;
const queue_time = (3 * 60 * 1000); // users get exclusive access to new word stories for 3 minutes
const minimum_story_length = 39; // currently doing this in firestore.rules
const starting_queue_number = 7; // number to get at start. should be enough for one round and to not get behind, but should stay low.
const extended = "... Read more: ";
const tweet_vote_threshold = 25;
const tweet_rating_threshold = 4;
const max_title_length = 45;
const max_word_length = 25;


// OK: Damn

// Helper Functions

var Twit = require('twit');

var T = new Twit({
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret: process.env.CONSUMER_SECRET,
    access_token: process.env.ACCESS_TOKEN,
    access_token_secret: process.env.ACCESS_TOKEN_SECRET,
    timeout_ms: 60 * 1000, // optional HTTP request timeout to apply to all requests.
    strictSSL: true // optional - requires SSL certificates to be valid.
});

// Backup 

const axios = require('axios');
const dateformat = require('dateformat');
const express = require('express'); // can delete?
const { google } = require('googleapis');


// BLUR

const mkdirp = require('mkdirp-promise');
const vision = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient();
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * When an image is uploaded we check if it is flagged as Adult or Violence by the Cloud Vision
 * API and if it is we blur it using ImageMagick.
 */

exports.blurOffensiveImages = functions.storage.object().onFinalize(async(object) => {

    // Check the image content using the Cloud Vision API.
    const data = await client.safeSearchDetection('gs://' + object.bucket + '/' + object.name);
    const safeSearch = data[0].safeSearchAnnotation;

    if (!(safeSearch || false))
        return null;

    console.log('SafeSearch results on image', safeSearch);

    if (safeSearch.adult === "VERY_LIKELY" || safeSearch.violence === "VERY_LIKELY" || false) {
        return blurImage(object.name, object.bucket, object.metadata);
    }
    return null;
});

/**
 * Blurs the given image located in the given bucket using ImageMagick.
 */
async function blurImage(filePath, bucketName, metadata) {
    const tempLocalFile = path.join(os.tmpdir(), filePath);
    const tempLocalDir = path.dirname(tempLocalFile);
    const bucket = admin.storage().bucket(bucketName);

    // Create the temp directory where the storage file will be downloaded.
    await mkdirp(tempLocalDir);
    console.log('Temporary directory has been created', tempLocalDir);
    // Download file from bucket.
    await bucket.file(filePath).download({ destination: tempLocalFile });
    console.log('The file has been downloaded to', tempLocalFile);
    // Blur the image using ImageMagick.
    await spawn('convert', [tempLocalFile, '-channel', 'RGBA', '-blur', '0x8', tempLocalFile]);
    console.log('Blurred image created at', tempLocalFile);
    // Uploading the Blurred image.
    await bucket.upload(tempLocalFile, {
        destination: filePath,
        metadata: { metadata: metadata }, // Keeping custom metadata.
    });
    console.log('Blurred image uploaded to Storage at', filePath);
    fs.unlinkSync(tempLocalFile);
    console.log('Deleted local file', filePath);
}

// Local Functions

function sanitize(word) {

    // not sure why this was getting undefined value.
    if (!(word || false))
        return "";

    if (word.substring(word.length - 5) === "[END]")
        return "[END]";

    // else
    return word.replace(/[^-'0-9a-zÀ-ÿ]|[Þß÷þø]/ig, "").toLowerCase().trim();

}



async function refillStoryQueue(which_user, fresh) {


    let the_time = new Date().getTime();
    let number_to_grab = (fresh) ? starting_queue_number : 1;
    let stories_to_write = [];
    let list_of_docs = [];


    // get all stories in the new word queue 
    return firestore.collection("Stories").where('date_finished', "==", 0).where('in_queue', "<", the_time - queue_time).orderBy('in_queue', 'asc').limit(limit).get().then(async(snapshot) => {

        if (snapshot.empty)
            return console.log("story writing queue is empty");

        // Get the stories they've already used

        await firestore.collection("Private").doc(which_user).get().then((nested_snapshot) => {
            return list_of_docs = nested_snapshot.stories || [];
        });

        snapshot.forEach((doc) => {

            if (doc.exists && stories_to_write.length < number_to_grab && list_of_docs.indexOf(doc.id) === -1) {

                stories_to_write.push(doc.id);

                firestore.collection("Stories").doc(doc.id).update({ "in_queue": the_time });
            }

        });

        let destination = { "queue_time": the_time, "queued_stories": stories_to_write };

        // If logged in, clear the table. Otherwise just add on. (removed and num_ = 0. why?)
        if (!fresh && stories_to_write.length > 0)
            destination = { "queue_time": the_time, "queued_stories": admin.firestore.FieldValue.arrayUnion.apply(this, stories_to_write) };

        // console.log("writing queued stories", stories_to_write.length, fresh);

        return firestore.collection('Private').doc(which_user).set(destination, { merge: true });

    }).catch((error) => {

        return console.log("Error getting finding queable stories:", error);

    });


}





// HTTP Functions

exports.generate_sitemap = functions.https.onRequest(async(req, res) => {


    let master = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

    let xml_now = new Date().toISOString();

    master += '<url><loc>https://basher.app/?show=about</loc><lastmod>' + xml_now + '</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>';
    master += '<url><loc>https://basher.app/?show=recent</loc><lastmod>' + xml_now + '</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>';
    master += '<url><loc>https://basher.app/?show=top</loc><lastmod>' + xml_now + '</lastmod><changefreq>hourly</changefreq><priority>0.9</priority></url>';
    master += '<url><loc>https://basher.app/</loc><lastmod>' + xml_now + '</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>';

    // Start

    return await firestore.collection("Stories").get().then((snapshot) => {



        snapshot.forEach((doc) => {

            let xml_data = doc.data();

            if (xml_data.story.length < 3)
                return false;

            let xml_time = new Date(xml_data.last_update).toISOString();
            let xml_change = "hourly";
            let xml_priority = "0.6";

            if (xml_data.pending_title === null) {
                xml_time = new Date(xml_data.date_finished).toISOString();
                xml_change = "monthly";

                if (xml_data.rating.score > tweet_rating_threshold && xml_data.rating.votes > tweet_vote_threshold)
                    xml_priority = "0.8";

            }

            master += '<url><loc>https://basher.app/?show=story&amp;id=' + doc.id + '</loc><lastmod>' + xml_time + '</lastmod><changefreq>' + xml_change + '</changefreq><priority>' + xml_priority + '</priority></url>';

        });

        master += '</urlset>';
        console.log(master);

        /*
        return fs.writeFile('../sitemap.xml', master, (err) => {
            if (err) throw err;
            console.log('Saved!');
        });

        */

        res.header('Access-Control-Allow-Origin', '*');
        res.type('application/xml');
        return res.send(master);

    }).catch((error) => { return console.log(error) });

    // Done

});


// TIMED FUNCTIONS


exports.backupDatabase = functions.pubsub.schedule('every 72 hours').onRun(async(context) => {

    const auth = await google.auth.getClient({
        scopes: ['https://www.googleapis.com/auth/datastore']
    });

    const accessTokenResponse = await auth.getAccessToken();
    const accessToken = accessTokenResponse.token;

    const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken
    };

    const body = {
        outputUriPrefix: "gs://milli0ns0fm0nkeys.appspot.com/Backups/" + dateformat(Date.now(), 'yyyy-mm-dd-HH-MM-ss')
    };

    const url = `https://firestore.googleapis.com/v1beta1/projects/milli0ns0fm0nkeys/databases/(default):exportDocuments`;

    try {
        const response = await axios.post(url, body, { headers: headers });
        console.log(response.data);

    } catch (e) {
        if (e.response) {
            console.warn(e.response.data);
        } else
            console.log(e);

    }
});


exports.updateTables = functions.pubsub.schedule('every 1 hours').onRun(async(context) => {


    await firestore.collection("Stories").orderBy('date_finished', 'desc').limit(table_limit).get().then((snapshot) => {

        let stories = [];

        snapshot.forEach((doc) => {
            if (doc.exists) {
                let data = doc.data();
                data.id = doc.id;
                stories.push(data);

            } else {
                // console.log("This story in the list doesn't exist.", doc);
            }
        });


        return firestore.collection("Messages").doc("global").update({

            "recent_stories": JSON.stringify(stories)
        });


    }).catch((error) => { return console.log(error) });


    return firestore.collection("Stories").orderBy('rating.score', 'desc').limit(table_limit).get().then((snapshot) => {


        let stories = [];

        snapshot.forEach((doc) => {
            if (doc.exists) {
                let data = doc.data();
                data.id = doc.id;
                stories.push(data);

            } else {
                // console.log("This story in the list doesn't exist.", doc);
            }
        });

        return firestore.collection("Messages").doc("global").update({

            "top_stories": JSON.stringify(stories)

        });

    }).catch((error) => { return console.log(error) });

});


exports.updateStats = functions.pubsub.schedule('every 1 hours').onRun((context) => {

    let stats = {

        total_users: 0,
        total_stories: 0,
        completed_stories: 0,
        most_points: { points: 0, user: 0 },
        most_created: { points: 0, user: 0 }

    };


    return firestore.collection("Stories").get().then((snapshot) => {

        //        let errors = [];

        snapshot.forEach((doc) => {

            let story_data = doc.data();

            stats.total_stories++;

            if (story_data.date_finished > 0)
                stats.completed_stories++

                /* ERROR CHECKING
                for (let i = 0; i < story_data.story.length; i++) {
                    if (story_data.story[i].indexOf("[END]") > -1)
                        errors.push({ "story": doc.id, "entry": i });
                }

                */


        });
        //  console.log(errors);

        return firestore.collection("Users").get().then((snapshot) => {

            let all_user_names = {};
            let now_time = new Date().getTime();
            let active_users = 0;

            snapshot.forEach((doc) => {

                let user_data = doc.data();

                stats.total_users++;

                if (user_data.recent_words.length >= 1 && user_data.last_login - now_time < 1 * 24 * 60 * 60 * 1000)
                    active_users++; // stats.active_users++;

                if (user_data.recent_words.length >= 1)
                    all_user_names[doc.id] = user_data.displayName;

                if (user_data.score > stats.most_points.points) {

                    stats.most_points = { points: user_data.score, user: doc.id }

                }

                if (user_data.stories_created > stats.most_created.points) {

                    stats.most_created = { points: user_data.stories_created, user: doc.id }

                }



            });

            console.log("active users: ", active_users);
            return firestore.collection("Messages").doc("global").update({

                "stats": stats,
                "displayNames": all_user_names
            });

        }).catch((error) => {
            console.log(error);
        })

    }).catch((error) => {
        console.log(error);
    })

});


exports.getDisplayNames = functions.https.onRequest(async(req, res) => {

    let uids = (JSON.parse(req.query.uids) || []);

    return firestore.collection("Messages").doc("global").get().then((data) => {

        let displayNames = data.data().displayNames;

        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');

        return res.send(JSON.stringify(uids.map(x => displayNames[x])));

    });

});

exports.addWord = functions.https.onRequest(async(req, res) => {

    // doesn't really add the word, just checks if its in the dictionary
    // get var "word"
    const the_word = req.query.word;

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    return res.send(JSON.stringify(await check_dictionary(the_word)));

});

exports.addTitle = functions.https.onRequest(async(req, res) => {

    // doesn't really add the title, just checks if its in the dictionary
    // get var "word"
    const the_word = sanitize(req.query.word);

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');

    if (the_word.length > max_title_length)
        return res.send("false");

    for (let i = 0; i < banned_words.length; i++) {
        if (the_word.indexOf(banned_words[i]) > -1)
            return res.send("false");
    }

    return res.send("true");

});




// LOCAL FUNCTIONS 

function is_banned_word(the_word) {

    if (the_word.length > max_word_length)
        return true;

    if (banned_words.indexOf(the_word) > -1 || banned_words.indexOf(the_word.substring(0, the_word.length - 1)) > -1 || the_word === "cum" || the_word === "ass" || the_word === "spic")
        return true;

    return false;


}

function check_dictionary(the_word) {

    console.log("dictioary checking", the_word);

    the_word = sanitize(the_word);

    if (is_banned_word(the_word))
        return false;

    if (the_word.substring(the_word.length - 5) === "[END]")
        return true;
    if (common_words.indexOf(the_word) > -1)
        return true;
    if (the_word.substring(the_word.length - 1) === "s" && common_words.indexOf(the_word.substring(0, the_word.length - 1)) > -1)
        return true;
    if (the_word.substring(the_word.length - 2) === "'s" && common_words.indexOf(the_word.substring(0, the_word.length - 2)) > -1)
        return true;
    if (the_word.substring(the_word.length - 3) === "ing" && common_words.indexOf(the_word.substring(0, the_word.length - 3)) > -1)
        return true;

    return unirest.get("https://wordsapiv1.p.rapidapi.com/words/" + the_word + "/frequency")
        .header("X-RapidAPI-Host", "wordsapiv1.p.rapidapi.com")
        .header("X-RapidAPI-Key", "941e4f9505msh22f8fcbc7b67fb1p1fb480jsn0172a19f54d3")
        .then((result) => {

            if (result.status === 200)
                return true;
            else
                return false;

        });

}



// When a user signs in for the first time and auth data is create, create a /Users entry for them
exports.userCreate = functions.auth.user().onCreate(async(new_data) => {


    firestore.collection('Private').doc(new_data.uid).set({ "demerits": 0, "stories": [] });
    firestore.collection('Messages').doc(new_data.uid).set({ "messages": [] });

    if (!(new_data.displayName || false)) {

        let await_user = await admin.auth().getUser(new_data.uid);

        let update_name_true = false;

        if (await_user.displayName || false) {
            update_name_true = true;

            for (let i = 0; i < banned_words.length; i++) {
                if (await_user.displayName.toLowerCase().indexOf(banned_words[i]) > -1) {
                    console.log("User used banned word in username.", await_user.displayName);
                    update_name_true = false;
                }
            }
        }

        if (update_name_true)
            new_data.displayName = await_user.displayName.substring(0, 15);
        else
            new_data.displayName = "Basher " + Math.floor(Math.random() * 999);

        console.log("getting displayname failed, but second attempt got: ", new_data.displayName, await_user);
    }


    return firestore.collection('Users').doc(new_data.uid).set({

        "displayName": new_data.displayName,
        "score": 0,
        "stories_created": 0,
        "last_login": new Date().getTime(),
        "logged_in": false, // i keep switching this. 
        "photoURL": (new_data.photoURL || "https://basher.app/images/user.png"),
        "recent_words": []
    }).then(() => {

        return refillStoryQueue(new_data.uid, true);

    });

});


// When user logs in, updates their name/email/photo 
exports.userUpdate = functions.firestore.document('/Users/{userID}').onUpdate((change, context) => {

    var oldData = (change.before.data() || []);
    var data = change.after.data();

    // console.log(oldData, data);

    var newData = {};

    var authData = {};


    // when the user logs in, we'll write a login time and refill the story queue.

    if (data.logged_in || false) {

        console.log("Logged in:", context.params.userID);
        refillStoryQueue(context.params.userID, true);

        var new_time = new Date().getTime();


        newData.logged_in = false;
        if (oldData.recent_words.length > number_of_recent_words)
            newData.recent_words = oldData.recent_words.slice(oldData.recent_words.length - number_of_recent_words);

        // One day since last login
        if (new_time - (data.last_login || 0) > 1000 * 60 * 60 * 24) {
            newData.score = (data.score || 0) + points.logged_in;

            firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.logged_in));

            firestore.collection('Messages').doc(context.params.userID).set({ "messages": admin.firestore.FieldValue.arrayUnion({ title: "Login bonus!", message: "+" + points.logged_in + " Points", timestamp: new Date().getTime() }) }, { merge: true });

            // only change this when poins are awarded. this doesnt break anything does it?
            newData.last_login = new_time;

        }

        return firestore.collection('Users').doc(context.params.userID).update(newData);

    }

    if ((data.displayName || false) !== (oldData.displayName || false) || (data.email || false) !== (oldData.email || false)) {

        console.log("Display name or email change");

        // if user changes displayname or email, it goes to user, now write it to auth.
        if ((data.displayName || false) !== (oldData.displayName || false)) {
            if (data.displayName !== (oldData.displayName || false)) {

                let update_name_true = true;

                for (let i = 0; i < banned_words.length; i++) {
                    if (data.displayName.indexOf(banned_words[i]) > -1) {
                        console.log("User used banned word in username.", data.displayName);
                        update_name_true = false;
                    }
                }

                if (update_name_true) {
                    authData.displayName = data.displayName;
                    console.log("Updated Name");
                }
            }
        }

        if ((data.email || false) !== (oldData.email || false)) {

            // if it's really changed, add it to the auth
            if (data.email !== (oldData.email || false)) {
                authData.email = data.email;
                console.log("Updated Email");
            }

            // old data plus new data minus email
            var returnedTarget = Object.assign(oldData, newData);

            delete returnedTarget.email;

            console.log("Writing usesr without email", newData);

            // nullify email asap
            firestore.collection('Users').doc(context.params.userID).set(returnedTarget).catch((error) => {
                console.log(error);
                return false;
            });

        }

        console.log("Writing auth", authData);

        // We only write auth changes to name and email, because we need these for emails and stuff
        return admin.auth().updateUser(context.params.userID, authData).catch((error) => {
            console.log(error);
            return false;
        });

    }

    return true;

});


// When a user makes a change to a story, submit it appropriately to Stories collection.

exports.submitRating = functions.firestore.document('/Users/{userID}/Stories/{storyID}').onWrite((change, context) => {

    var data = change.after.data() || {};
    var previousData = change.before.data() || {};

    if (data.rating && (data.rating !== (previousData.rating || false))) {

        return firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();
            var score = story_data.rating.score;
            var votes = story_data.rating.votes;
            var newData = {};

            if (!previousData.rating) {

                score = (score * votes + data.rating) / (votes + 1);
                votes++;
                firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.rating));

            } else if (votes > 0)
                score = (score * votes + data.rating - previousData.rating) / votes;
            else
                score = 0;

            newData.rating = { "score": score, "votes": votes };



            // Process Stories with certain ratings

            if (votes === tweet_vote_threshold && score >= tweet_rating_threshold && (story_data.title || false)) {
                let story_string = "";
                for (let i = 0; i < story_data.story.length; i++) {
                    story_string += story_data.story[i];
                }

                let tweet = story_data.title + "\n" + story_string;
                tweet = tweet.substring(0, tweet.lastIndexOf(" ", 280 - 23 - extended.length));
                tweet = tweet + extended + "https://basher.app/?show=story&id=" + story_data.id;

                console.log("Tweet: ", tweet);



                /*
                                T.post('statuses/update', { status: tweet }, (err, data, response) => {
                                    console.log(err, data, response);
                                });

                                */

                // Give points to users

                for (let i = 0; i < story_data.contributors; i++) {

                    firestore.collection('Messages').doc(story_data.contributors[i]).set({ "messages": admin.firestore.FieldValue.arrayUnion({ title: "You-co-wrote a top story!", message: "+" + points.high + " Points: " + '<div onclick="get_user(\'' + story_data.id + '\')">' + story_data.title + '</div>', timestamp: new Date().getTime() }) }, { merge: true });

                }


            }



            if (data.rating === 5) {

                newData.favorites = story_data.favorites.concat([context.params.userID]);

            } else {

                newData.favorites = story_data.favorites.filter((value) => {

                    return value !== context.params.userID;

                });

            }

            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {
            console.log(error);
            return false;
        });

    } else
        return true;

});


exports.storyUpdate = functions.firestore.document('/Users/{userID}/Stories/{storyID}').onCreate((change, context) => {

    var data = change.data();
    data.punctuation = (data.punctuation || "");

    var the_time = new Date().getTime();

    var newData = {};

    firestore.collection('Private').doc(context.params.userID).set({ "stories": admin.firestore.FieldValue.arrayUnion(context.params.storyID) }, { merge: true });

    if (data.no_vote || data.yes_vote || data.new_word)
        refillStoryQueue(context.params.userID, false);

    function add_the_word() {

        console.log("adding word:", data.new_word);

        // add it to user's recent word submissions
        if (data.new_word.substring(data.new_word.length - 5) !== "[END]") {
            firestore.collection('Users').doc(context.params.userID).update({ "recent_words": admin.firestore.FieldValue.arrayUnion(data.new_word) }).catch((error) => {
                console.error("Error adding to recent words", error);
                return false;
            });
        }

        // we need to get data about the story so we can add the contributor and make changes and stuff
        return firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {


            var story_data = doc.data() || false;

            newData.pending_word = { "downvotes": 0, "upvotes": 0, "punctuation": data.punctuation, "word": sanitize(data.new_word), "contributor": context.params.userID };

            newData.last_update = the_time;

            if (story_data) {

                newData.contributors = story_data.contributors.concat([story_data.pending_word.contributor]);
                newData.story = story_data.story.concat([(story_data.pending_word.punctuation || "") + " " + story_data.pending_word.word]);

                // Give user points for having their word confirmed
                firestore.collection('Users').doc(story_data.pending_word.contributor).update("score", admin.firestore.FieldValue.increment(points.added_word));

                // Notify user their word was confirmed
                firestore.collection('Messages').doc(story_data.pending_word.contributor).set({ "messages": admin.firestore.FieldValue.arrayUnion({ title: "Your word was approved!", message: "<div onclick=\"get_story('" + doc.id + "')\">+" + points.added_word + " Points: " + story_data.pending_word.word + "</div>", timestamp: new Date().getTime() }) }, { merge: true });


            } else {
                // Replaces storyCreate function
                newData.contributors = [];
                newData.story = [];
                newData.date_finished = 0;
                newData.favorites = [];
                newData.pending_title = [];
                newData.in_queue = 0;
                newData.rating = {
                    score: 0,
                    votes: 0
                };
                newData.title = 0;

                firestore.collection("Users").doc(context.params.userID).update("stories_created", admin.firestore.FieldValue.increment(1));

            }

            // console.log(newData);

            // has to be set because this is how we create new stories 
            return firestore.collection('Stories').doc(context.params.storyID).set(newData, { merge: true });

        }).catch((error) => {

            console.log(error);
            return false;
        });
    }

    if (data.new_word) {

        data.new_word = sanitize(data.new_word);

        console.log("new_word", data.new_word);

        if (!check_dictionary(data.new_word)) {

            console.log("dictioary check failed, returning to thread", data.new_word);

            // check user score
            return firestore.collection('Users').doc(context.params.userID).get().then((doc) => {

                var the_user_data = doc.data();

                if (the_user_data.score < 1000 || is_banned_word(data.new_word)) {
                    console.log("Rejected word after score check", data.new_word, "banned?", is_banned_word(data.new_word));
                    return false;
                } else {
                    console.log("user had high enough score to submit garbage and it wasnt banned", data.new_word);
                    return add_the_word();
                }

            }).catch((error) => {
                console.log("error with the deictionary score hceck ting", data.new_word, error);
            });


        } else {

            console.log("dictory check passed.", data.new_word);
            return add_the_word();
        }


    } else if (data.no_vote) {

        console.log("no_vote");

        firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.vote));

        return firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();

            if (story_data.date_finished > 0)
                return;

            newData.pending_word = story_data.pending_word;
            newData.pending_word.downvotes++;

            if (newData.pending_word.downvotes >= number_of_votes_needed) {

                // if there is no first word, it means this story is officilly nuked
                if (!(story_data.story[0] || false)) {
                    return firestore.collection('Stories').doc(context.params.storyID).delete();
                }

                newData.pending_word.downvotes = 0;
                newData.pending_word.word = sanitize(story_data.story.splice(-1, 1).toString());
                newData.pending_word.contributor = story_data.contributors.splice(-1, 1).toString();
                newData.story = story_data.story;
                newData.contributors = story_data.contributors;

                firestore.collection('Private').doc(story_data.pending_word.contributor).update("demerits", admin.firestore.FieldValue.increment(1));

            }

            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {

            console.log(error);
            return false;
        });

    } else if (data.yes_vote) {



        console.log("yes_vote");

        firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.vote));

        return firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();

            // dont accept votes on finsihed stories
            if (story_data.date_finished > 0)
                return false;

            story_data.pending_word.upvotes++;

            if (story_data.pending_word.word.substring(story_data.pending_word.word.length - 5) === "[END]" && story_data.pending_word.upvotes >= number_of_votes_needed) {

                if (story_data.pending_word.punctuation || false) {
                    newData.contributors = story_data.contributors.concat([story_data.pending_word.contributor]);
                    newData.story = story_data.story.concat([(story_data.pending_word.punctuation)]);
                }

                newData.date_finished = the_time;
                console.log("story completed", context.params.storyID);
                return firestore.collection('Stories').doc(context.params.storyID).update(newData);
            } else {


                console.log("upvote recorded");

                return firestore.collection('Stories').doc(context.params.storyID).update("pending_word", story_data.pending_word);
            }

        }).catch((error) => {
            console.log("yes vote: ", error);
        });

    } else if (data.title_vote) {

        console.log("title vote incoming", data.title_vote, data.submit_title);

        var adjusted_title_vote_position = data.title_vote - 2;

        return firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();

            if (story_data.pending_title === null) {
                console.log("received title vote for null title");
                return false;
            }

            firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.vote));

            newData.pending_title = (story_data.pending_title || []);


            if (data.title_vote === 1 && data.submit_title) {

                const the_new_title = { "contributor": context.params.userID, "title": data.submit_title, "votes": 0 };



                newData.pending_title.push(the_new_title);
                console.log("title subbmission:", the_new_title, newData.pending_title);

            } else if (data.title_vote > 1) {

                console.log("title vote:", adjusted_title_vote_position);

                if (!(newData.pending_title[adjusted_title_vote_position].title || false)) {
                    console.log("vote fot non-existant title");
                    return false;
                }

                newData.pending_title[adjusted_title_vote_position].votes++;

                if (newData.pending_title[adjusted_title_vote_position].votes >= neccesary_title_votes) {

                    newData.title = newData.pending_title[adjusted_title_vote_position].title;
                    newData.contributors = story_data.contributors.concat([story_data.pending_title[adjusted_title_vote_position].contributor]);
                    newData.pending_title = null;

                    firestore.collection('Users').doc(story_data.pending_title[adjusted_title_vote_position].contributor).update("score", admin.firestore.FieldValue.increment(points.title_chosen));

                    firestore.collection('Messages').doc(story_data.pending_title[adjusted_title_vote_position].contributor).set({ "messages": admin.firestore.FieldValue.arrayUnion({ title: "Your Title Was Chosen!", message: "<div onclick=\"get_story('" + doc.id + "')\">+" + points.title_chosen + " Points: " + newData.title + "</div>", timestamp: new Date().getTime() }) }, { merge: true });

                }

            }



            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {
            console.log(error);
            return false;
        });

    } else
        return true;

});