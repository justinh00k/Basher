// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');

admin.initializeApp();

const firestore = admin.firestore();

// Required for checktion dictionary
const unirest = require('unirest');

const development_mode = false; // allows for user to submit new word to same story twice

const points = {
    added_word: 5,
    title_vote: 1,
    rating: 1,
    title_chosen: 10,
    logged_in: 5
};


const number_of_recent_words = 5;
const number_of_votes_needed = 2; // To vote words or end votes  out.
const neccesary_title_votes = 3;
const limit = 25; // Number of stories to fetch when producing story queue
const queue_time = (3 * 60 * 1000); // users get exclusive access to new word stories for 3 minutes
const starting_queue_number = 7; // number to get at start. should be enough for one round and to not get behind, but should stay low.

var common_words = [];



// Helper Functions



function sanitize(word) {

    // not sure why this was getting undefined value.
    if (!(word || false))
        return "";

    if (word === "[END]")
        return word;

    // else
    return word.replace(/[^-'0-9a-zÀ-ÿ]|[Þß÷þø]/ig, "").toLowerCase().trim();

}



function refillStoryQueue(which_user, fresh) {


    var the_time = new Date().getTime();

    var number_of_queued_stories = 0;

    var number_to_grab = 1;

    if (fresh) // if we just logged in get more
        number_to_grab = starting_queue_number;

    // get all stories in the new word queue 
    firestore.collection("Stories").where('date_finished', "==", 0).where('in_queue', "<", the_time - queue_time).orderBy('in_queue', 'asc').limit(limit).get().then((snapshot) => {

        if (!snapshot.empty) {

            var list_of_docs = [];

            // Get the stories they've already used

            firestore.collection("Users").doc(which_user).collection("Stories").get().then((nested_snapshot) => {


                if (!nested_snapshot.empty) {

                    nested_snapshot.forEach((nested_doc) => {

                        list_of_docs.push(nested_doc.id);


                    });


                }

                // Once we get their stories, check them against the available queue 

                var stories_to_write = [];


                snapshot.forEach((doc) => {

                    if (doc.exists && number_of_queued_stories < number_to_grab && (list_of_docs.indexOf(doc.id) === -1 || development_mode)) {

                        number_of_queued_stories++;

                        // Save for writing
                        stories_to_write.push(doc.id);

                        // but mark them as queued
                        firestore.collection("Stories").doc(doc.id).update({ "in_queue": the_time }).catch((error) => {
                            console.error("Error writing in_queue time to queued story: ", error);
                            return false;
                        });
                    }
                });




                var destination = { "queue_time": the_time, "queued_stories": stories_to_write };


                // If logged in, clear the table. Otherwise just add on. (removed and num_ = 0. why?)
                if (!fresh && stories_to_write.length > 0)
                    destination = { "queue_time": the_time, "queued_stories": admin.firestore.FieldValue.arrayUnion.apply(this, stories_to_write) };

                console.log("writing queued stories", number_of_queued_stories, fresh);


                return firestore.collection('Private').doc(which_user).set(destination, { merge: true }).catch((error) => {
                    console.error("Error updating user's queue array", error);
                    return false;
                });

            }).catch((error) => {

                console.error("Error getting user's list of stories:", error);
                return false;

            });

        }

        return true;

    }).catch((error) => {

        console.log("Error getting finding queable stories:", error);
        return false;

    });


}


// HTTP Functions


exports.mass_delete_users = functions.https.onRequest(async(req, res) => {

    // separated by UID
    var users_to_delete = [

    ];

    var error_string = "";
    for (var i = 0; i < users_to_delete.length; i++) {
        /*
                admin.auth().deleteUser(users_to_delete[i]).catch((error) => {
                    error_string += error;
                });
                */

        firestore.collection("Users").doc(users_to_delete[i]).delete();


    }


    return error_string;

});


function check_dictionary(the_word) {


    if (the_word === "[END]" || common_words.indexOf(the_word) > -1 || common_words.indexOf(the_word.substring(0, the_word.length - 1)) > -1 || common_words.indexOf(the_word.substring(0, the_word.length - 2)) > -1)
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

exports.addWord = functions.https.onRequest(async(req, res) => {

    // doesn't really add the word, just checks if its in the dictionary
    // get var "word"
    const the_word = req.query.word;

    res.header('Access-Control-Allow-Origin', '*');
    res.send(JSON.stringify(await check_dictionary(the_word)));

});



// When a user signs in for the first time and auth data is create, create a /Users entry for them
exports.userCreate = functions.auth.user().onCreate((new_data) => {

    return firestore.collection('Users').doc(new_data.uid).set({

        "displayName": (new_data.displayName || "Basher " + Math.floor(Math.random() * 999)),
        "score": 0,
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

            // only change this when poins are awarded. this doesnt break anything does it?
            newData.last_login = new_time;

        }



        firestore.collection('Users').doc(context.params.userID).update(newData).then(() => {

            return true;
        }).catch((error) => {
            console.log(error);
            return false;
        });


    }

    if ((data.displayName || false) !== (oldData.displayName || false) || (data.email || false) !== (oldData.email || false)) {

        console.log("Display name or email change");

        // if user changes displayname or email, it goes to user, now write it to auth.
        if ((data.displayName || false) !== (oldData.displayName || false)) {
            if (data.displayName !== (oldData.displayName || false)) {
                authData.displayName = data.displayName;
                console.log("Updated Name");
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


exports.storyUpdate = functions.firestore.document('/Users/{userID}/Stories/{storyID}').onUpdate((change, context) => {

    var data = change.after.data();
    var previousData = change.before.data() || {};


    var the_time = new Date().getTime();

    var newData = {};

    function add_the_word() {

        // console.log("adding word");

        // add it to user's recent word submissions
        firestore.collection('Users').doc(context.params.userID).update({ "recent_words": admin.firestore.FieldValue.arrayUnion(data.new_word) }).catch((error) => {
            console.error("Error adding to recent words", error);
            return false;
        });

        // we need to get data about the story so we can add the contributor and make changes and stuff
        firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {


            var story_data = doc.data() || false;

            newData.pending_word = { "downvotes": 0, "word": (data.punctuation || "") + " " + sanitize(data.new_word), "contributor": context.params.userID };
            newData.last_update = the_time;

            // If someone says its not done and adds more, reset the end votes.
            newData.end_votes = 0;

            if (story_data) {

                newData.contributors = story_data.contributors.concat([story_data.pending_word.contributor]);
                newData.story = story_data.story.concat([story_data.pending_word.word]);
                firestore.collection('Users').doc(story_data.pending_word.contributor).update("score", admin.firestore.FieldValue.increment(points.added_word));

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
            }

            // console.log(newData);

            // has to be set because this is how we create new stories 
            return firestore.collection('Stories').doc(context.params.storyID).set(newData, { merge: true });

        }).catch((error) => {

            console.log(error);
            return false;
        });
    }

    if (data.new_word && (!(previousData.new_word || false) || (data.new_word !== (previousData.new_word || false) && development_mode))) {

        data.new_word = sanitize(data.new_word);

        refillStoryQueue(context.params.userID, false);

        if (!check_dictionary(data.new_word)) {

            // check user score
            firestore.collection('Users').doc(context.params.userID).get().then((doc) => {

                var the_user_data = doc.data();

                if (the_user_data.score < 1000) {
                    console.log("Rejected word and score under 1000", data.new_word);
                    return false;
                } else {
                    console.log("user had high enough score to submit garbage", data.new_word);
                    return add_the_word();
                }

            }).catch((error) => {
                console.log("error with the deictionary score hceck ting", data.new_word, error);
            });


        } else {

            console.log("dictory check passed.", data.new_word);
            add_the_word();
        }


    }


    if (data.end_vote && (!(previousData.end_vote || false) || (data.end_vote !== (previousData.end_vote || false) && development_mode))) {

        refillStoryQueue(context.params.userID, false);

        firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();

            newData.end_votes = (story_data.end_votes || 0) + 1;

            if (newData.end_votes >= number_of_votes_needed) {

                newData.date_finished = the_time;

            }

            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {

            console.log(error);
            return false;
        });

    }

    if (data.no_vote && (!(previousData.no_vote || false) || (data.no_vote !== (previousData.no_vote || false) && development_mode))) {

        refillStoryQueue(context.params.userID, false);

        firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();

            // just changed this. why was it {} before?
            newData.pending_word = story_data.pending_word;
            newData.pending_word.downvotes = story_data.pending_word.downvotes + 1;

            if (newData.pending_word.downvotes >= number_of_votes_needed) {

                // if we vote out the first word of a story
                if (!(story_data.story[0] || false)) {
                    return firestore.collection('Stories').doc(context.params.storyID).delete();
                }

                newData.pending_word.downvotes = 0;
                newData.pending_word.word = story_data.story.splice(-1, 1).toString();
                newData.pending_word.contributor = story_data.contributors.splice(-1, 1).toString();
                newData.story = story_data.story;
                newData.contributors = story_data.contributors;

            }

            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {

            console.log(error);
            return false;
        });

    }


    if (data.rating && (data.rating !== (previousData.rating || false))) {

        firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();
            var score = story_data.rating.score;
            var votes = story_data.rating.votes;

            if (!previousData.rating) {

                score = (score * votes + data.rating) / (votes + 1);
                votes++;
                firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.rating));

            } else
                score = (score * votes + data.rating - previousData.rating) / votes;

            newData.rating = { "score": score, "votes": votes };

            if (data.rating === 5) {

                newData.favorites = story_data.favorites.concat([context.params.userID]);

            } else {

                newData.favorites = story_data.favorites.filter((value, index, arr) => {

                    return value !== context.params.userID;

                });

            }

            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {
            console.log(error);
            return false;
        });

    }

    if (data.title_vote && (!(previousData.title_vote || false) || (data.title_vote !== (previousData.title_vote || false) && development_mode))) {

        var adjusted_title_vote_position = data.title_vote - 2;

        firestore.collection('Stories').doc(context.params.storyID).get().then((doc) => {

            var story_data = doc.data();
            newData.pending_title = story_data.pending_title;


            if (data.title_vote === 1) {

                const the_new_title = { "contributor": context.params.userID, "title": data.submit_title, "votes": 0 };

                newData.pending_title.push(the_new_title);

            } else {

                newData.pending_title[adjusted_title_vote_position].votes++;

                if (newData.pending_title[adjusted_title_vote_position].votes >= neccesary_title_votes) {

                    newData.title = newData.pending_title[adjusted_title_vote_position].title;
                    newData.contributors = story_data.contributors.concat([story_data.pending_title[adjusted_title_vote_position].contributor]);
                    newData.pending_title = null;

                    firestore.collection('Users').doc(story_data.pending_title[adjusted_title_vote_position].contributor).update("score", admin.firestore.FieldValue.increment(points.title_chosen));

                }

            }
            firestore.collection('Users').doc(context.params.userID).update("score", admin.firestore.FieldValue.increment(points.title_vote));


            console.log(newData);
            return firestore.collection('Stories').doc(context.params.storyID).update(newData);

        }).catch((error) => {
            console.log(error);
            return false;
        });

    }


    return true;
});



common_words = ["is", "was", "were", "the", "be", "and", "of", "a", "in", "to", "have", "to", "it", "i", "that", "for", "you", "he", "with", "on", "do", "say", "this", "they", "at", "but", "we", "his", "from", "that", "not", "n't", "by", "she", "or", "as", "what", "go", "their", "can", "who", "get", "if", "would", "her", "all", "my", "make", "about", "know", "will", "as", "up", "one", "time", "there", "year", "so", "think", "when", "which", "them", "some", "me", "people", "take", "out", "into", "just", "see", "him", "your", "come", "could", "now", "than", "like", "other", "how", "then", "its", "our", "two", "more", "these", "want", "way", "look", "first", "also", "new", "because", "day", "more", "use", "no", "man", "find", "here", "thing", "give", "many", "well", "only", "those", "tell", "one", "very", "her", "even", "back", "any", "good", "woman", "through", "us", "life", "child", "there", "work", "down", "may", "after", "should", "call", "world", "over", "school", "still", "try", "in", "as", "last", "ask", "need", "too", "feel", "three", "when", "state", "never", "become", "between", "high", "really", "something", "most", "another", "much", "family", "own", "out", "leave", "put", "old", "while", "mean", "on", "keep", "student", "why", "let", "great", "same", "big", "group", "begin", "seem", "country", "help", "talk", "where", "turn", "problem", "every", "start", "hand", "might", "american", "show", "part", "about", "against", "place", "over", "such", "again", "few", "case", "most", "week", "company", "where", "system", "each", "right", "program", "hear", "so", "question", "during", "work", "play", "government", "run", "small", "number", "off", "always", "move", "like", "night", "live", "mr", "point", "believe", "hold", "today", "bring", "happen", "next", "without", "before", "large", "all", "million", "must", "home", "under", "water", "room", "write", "mother", "area", "national", "money", "story", "young", "fact", "month", "different", "lot", "right", "study", "book", "eye", "job", "word", "though", "business", "issue", "side", "kind", "four", "head", "far", "black", "long", "both", "little", "house", "yes", "after", "since", "long", "provide", "service", "around", "friend", "important", "father", "sit", "away", "until", "power", "hour", "game", "often", "yet", "line", "political", "end", "among", "ever", "stand", "bad", "lose", "however", "member", "pay", "law", "meet", "car", "city", "almost", "include", "continue", "set", "later", "community", "much", "name", "five", "once", "white", "least", "president", "learn", "real", "change", "team", "minute", "best", "several", "idea", "kid", "body", "information", "nothing", "ago", "right", "lead", "social", "understand", "whether", "back", "watch", "together", "follow", "around", "parent", "only", "stop", "face", "anything", "create", "public", "already", "speak", "others", "read", "level", "allow", "add", "office", "spend", "door", "health", "person", "art", "sure", "such", "war", "history", "party", "within", "grow", "result", "open", "change", "morning", "walk", "reason", "low", "win", "research", "girl", "guy", "early", "food", "before", "moment", "himself", "air", "teacher", "force", "offer", "enough", "both", "education", "across", "although", "remember", "foot", "second", "boy", "maybe", "toward", "able", "age", "off", "policy", "everything", "love", "process", "music", "including", "consider", "appear", "actually", "buy", "probably", "human", "wait", "serve", "market", "die", "send", "expect", "home", "sense", "build", "stay", "fall", "oh", "nation", "plan", "cut", "college", "interest", "death", "course", "someone", "experience", "behind", "reach", "local", "kill", "six", "remain", "effect", "use", "yeah", "suggest", "class", "control", "raise", "care", "perhaps", "little", "late", "hard", "field", "else", "pass", "former", "sell", "major", "sometimes", "require", "along", "development", "themselves", "report", "role", "better", "economic", "effort", "up", "decide", "rate", "strong", "possible", "heart", "drug", "show", "leader", "light", "voice", "wife", "whole", "police", "mind", "finally", "pull", "return", "free", "military", "price", "report", "less", "according", "decision", "explain", "son", "hope", "even", "develop", "view", "relationship", "carry", "town", "road", "drive", "arm", "true", "federal", "break", "better", "difference", "thank", "receive", "value", "international", "building", "action", "full", "model", "join", "season", "society", "because", "tax", "director", "early", "position", "player", "agree", "especially", "record", "pick", "wear", "paper", "special", "space", "ground", "form", "support", "event", "official", "whose", "matter", "everyone", "center", "couple", "site", "end", "project", "hit", "base", "activity", "star", "table", "need", "court", "produce", "eat", "american", "teach", "oil", "half", "situation", "easy", "cost", "industry", "figure", "face", "street", "image", "itself", "phone", "either", "data", "cover", "quite", "picture", "clear", "practice", "piece", "land", "recent", "describe", "product", "doctor", "wall", "patient", "worker", "news", "test", "movie", "certain", "north", "love", "personal", "open", "support", "simply", "third", "technology", "catch", "step", "baby", "computer", "type", "attention", "draw", "film", "republican", "tree", "source", "red", "nearly", "organization", "choose", "cause", "hair", "look", "point", "century", "evidence", "window", "difficult", "listen", "soon", "culture", "billion", "chance", "brother", "energy", "period", "course", "summer", "less", "realize", "hundred", "available", "plant", "likely", "opportunity", "term", "short", "letter", "condition", "choice", "place", "single", "rule", "daughter", "administration", "south", "husband", "congress", "floor", "campaign", "material", "population", "well", "call", "economy", "medical", "hospital", "church", "close", "thousand", "risk", "current", "fire", "future", "wrong", "involve", "defense", "anyone", "increase", "security", "bank", "myself", "certainly", "west", "sport", "board", "seek", "per", "subject", "officer", "private", "rest", "behavior", "deal", "performance", "fight", "throw", "top", "quickly", "past", "goal", "second", "bed", "order", "author", "fill", "represent", "focus", "foreign", "drop", "plan", "blood", "upon", "agency", "push", "nature", "color", "no", "recently", "store", "reduce", "sound", "note", "fine", "before", "near", "movement", "page", "enter", "share", "than", "common", "poor", "other", "natural", "race", "concern", "series", "significant", "similar", "hot", "language", "each", "usually", "response", "dead", "rise", "animal", "factor", "decade", "article", "shoot", "east", "save", "seven", "artist", "away", "scene", "stock", "career", "despite", "central", "eight", "thus", "treatment", "beyond", "happy", "exactly", "protect", "approach", "lie", "size", "dog", "fund", "serious", "occur", "media", "ready", "sign", "thought", "list", "individual", "simple", "quality", "pressure", "accept", "answer", "hard", "resource", "identify", "left", "meeting", "determine", "prepare", "disease", "whatever", "success", "argue", "cup", "particularly", "amount", "ability", "staff", "recognize", "indicate", "character", "growth", "loss", "degree", "wonder", "attack", "herself", "region", "television", "box", "tv", "training", "pretty", "trade", "deal", "election", "everybody", "physical", "lay", "general", "feeling", "standard", "bill", "message", "fail", "outside", "arrive", "analysis", "benefit", "name", "sex", "forward", "lawyer", "present", "section", "environmental", "glass", "answer", "skill", "sister", "pm", "professor", "operation", "financial", "crime", "stage", "ok", "compare", "authority", "miss", "design", "sort", "one", "act", "ten", "knowledge", "gun", "station", "blue", "state", "strategy", "little", "clearly", "discuss", "indeed", "force", "truth", "song", "example", "democratic", "check", "environment", "leg", "dark", "public", "various", "rather", "laugh", "guess", "executive", "set", "study", "prove", "hang", "entire", "rock", "design", "enough", "forget", "since", "claim", "note", "remove", "manager", "help", "close", "sound", "enjoy", "network", "legal", "religious", "cold", "form", "final", "main", "science", "green", "memory", "card", "above", "seat", "cell", "establish", "nice", "trial", "expert", "that", "spring", "firm", "democrat", "radio", "visit", "management", "care", "avoid", "imagine", "tonight", "huge", "ball", "no", "close", "finish", "yourself", "talk", "theory", "impact", "respond", "statement", "maintain", "charge", "popular", "traditional", "onto", "reveal", "direction", "weapon", "employee", "cultural", "contain", "peace", "head", "control", "base", "pain", "apply", "play", "measure", "wide", "shake", "fly", "interview", "manage", "chair", "fish", "particular", "camera", "structure", "politics", "perform", "bit", "weight", "suddenly", "discover", "candidate", "top", "production", "treat", "trip", "evening", "affect", "inside", "conference", "unit", "best", "style", "adult", "worry", "range", "mention", "rather", "far", "deep", "past", "edge", "individual", "specific", "writer", "trouble", "necessary", "throughout", "challenge", "fear", "shoulder", "institution", "middle", "sea", "dream", "bar", "beautiful", "property", "instead", "improve", "stuff", "detail", "method", "sign", "somebody", "magazine", "hotel", "soldier", "reflect", "heavy", "sexual", "cause", "bag", "heat", "fall", "marriage", "tough", "sing", "surface", "purpose", "exist", "pattern", "whom", "skin", "agent", "owner", "machine", "gas", "down", "ahead", "generation", "commercial", "address", "cancer", "test", "item", "reality", "coach", "step", "mrs", "yard", "beat", "violence", "total", "tend", "investment", "discussion", "finger", "garden", "notice", "collection", "modern", "task", "partner", "positive", "civil", "kitchen", "consumer", "shot", "budget", "wish", "painting", "scientist", "safe", "agreement", "capital", "mouth", "nor", "victim", "newspaper", "instead", "threat", "responsibility", "smile", "attorney", "score", "account", "interesting", "break", "audience", "rich", "dinner", "figure", "vote", "western", "relate", "travel", "debate", "prevent", "citizen", "majority", "none", "front", "born", "admit", "senior", "assume", "wind", "key", "professional", "mission", "fast", "alone", "customer", "suffer", "speech", "successful", "option", "participant", "southern", "fresh", "eventually", "no", "forest", "video", "global", "senate", "reform", "access", "restaurant", "judge", "publish", "cost", "relation", "like", "release", "own", "bird", "opinion", "credit", "critical", "corner", "concerned", "recall", "version", "stare", "safety", "effective", "neighborhood", "original", "act", "troop", "income", "directly", "hurt", "species", "immediately", "track", "basic", "strike", "hope", "sky", "freedom", "absolutely", "plane", "nobody", "achieve", "object", "attitude", "labor", "refer", "concept", "client", "powerful", "perfect", "nine", "therefore", "conduct", "announce", "conversation", "examine", "touch", "please", "attend", "completely", "vote", "variety", "sleep", "turn", "involved", "investigation", "nuclear", "researcher", "press", "conflict", "spirit", "experience", "replace", "british", "encourage", "argument", "by", "once", "camp", "brain", "feature", "afternoon", "am", "weekend", "dozen", "possibility", "along", "insurance", "department", "battle", "beginning", "date", "generally", "african", "very", "sorry", "crisis", "complete", "fan", "stick", "define", "easily", "through", "hole", "element", "vision", "status", "normal", "chinese", "ship", "solution", "stone", "slowly", "scale", "bit", "university", "introduce", "driver", "attempt", "park", "spot", "lack", "ice", "boat", "drink", "sun", "front", "distance", "wood", "handle", "truck", "return", "mountain", "survey", "supposed", "tradition", "winter", "village", "soviet", "refuse", "sales", "roll", "communication", "run", "screen", "gain", "resident", "hide", "gold", "club", "future", "farm", "potential", "increase", "middle", "european", "presence", "independent", "district", "shape", "reader", "ms", "contract", "crowd", "christian", "express", "apartment", "willing", "strength", "previous", "band", "obviously", "horse", "interested", "target", "prison", "ride", "guard", "terms", "demand", "reporter", "deliver", "text", "share", "tool", "wild", "vehicle", "observe", "flight", "inside", "facility", "understanding", "average", "emerge", "advantage", "quick", "light", "leadership", "earn", "pound", "basis", "bright", "operate", "guest", "sample", "contribute", "tiny", "block", "protection", "settle", "feed", "collect", "additional", "while", "highly", "identity", "title", "mostly", "lesson", "faith", "river", "promote", "living", "present", "count", "unless", "marry", "tomorrow", "technique", "path", "ear", "shop", "folk", "order", "principle", "survive", "lift", "border", "competition", "jump", "gather", "limit", "fit", "claim", "cry", "equipment", "worth", "associate", "critic", "warm", "aspect", "result", "insist", "failure", "annual", "french", "christmas", "comment", "responsible", "affair", "approach", "until", "procedure", "regular", "spread", "chairman", "baseball", "soft", "ignore", "egg", "measure", "belief", "demonstrate", "anybody", "murder", "gift", "religion", "review", "editor", "past", "engage", "coffee", "document", "speed", "cross", "influence", "anyway", "threaten", "commit", "female", "youth", "wave", "move", "afraid", "quarter", "background", "native", "broad", "wonderful", "deny", "apparently", "slightly", "reaction", "twice", "suit", "perspective", "growing", "blow", "construction", "kind", "intelligence", "destroy", "cook", "connection", "charge", "burn", "shoe", "view", "grade", "context", "committee", "hey", "mistake", "focus", "smile", "location", "clothes", "indian", "quiet", "dress", "promise", "aware", "neighbor", "complete", "drive", "function", "bone", "active", "extend", "chief", "average", "combine", "wine", "below", "cool", "voter", "mean", "demand", "learning", "bus", "hell", "dangerous", "remind", "moral", "united", "category", "relatively", "victory", "key", "academic", "visit", "internet", "healthy", "fire", "negative", "following", "historical", "medicine", "tour", "depend", "photo", "finding", "grab", "direct", "classroom", "contact", "justice", "participate", "daily", "fair", "pair", "famous", "exercise", "knee", "flower", "tape", "hire", "familiar", "appropriate", "supply", "fully", "cut", "will", "actor", "birth", "search", "tie", "democracy", "eastern", "primary", "yesterday", "circle", "device", "progress", "next", "front", "bottom", "island", "exchange", "clean", "studio", "train", "lady", "colleague", "application", "neck", "lean", "damage", "plastic", "tall", "plate", "hate", "otherwise", "writing", "press", "male", "start", "alive", "expression", "football", "intend", "attack", "chicken", "army", "abuse", "theater", "shut", "map", "extra", "session", "danger", "welcome", "domestic", "lots", "literature", "rain", "desire", "assessment", "injury", "respect", "northern", "nod", "paint", "fuel", "leaf", "direct", "dry", "russian", "instruction", "fight", "pool", "climb", "sweet", "lead", "engine", "fourth", "salt", "expand", "importance", "metal", "fat", "ticket", "software", "disappear", "corporate", "strange", "lip", "reading", "urban", "mental", "increasingly", "lunch", "educational", "somewhere", "farmer", "above", "sugar", "planet", "favorite", "explore", "obtain", "enemy", "greatest", "complex", "surround", "athlete", "invite", "repeat", "carefully", "soul", "scientific", "impossible", "panel", "meaning", "mom", "married", "alone", "instrument", "predict", "weather", "presidential", "emotional", "commitment", "supreme", "bear", "pocket", "thin", "temperature", "surprise", "poll", "proposal", "consequence", "half", "breath", "sight", "cover", "balance", "adopt", "minority", "straight", "attempt", "connect", "works", "teaching", "belong", "aid", "advice", "okay", "photograph", "empty", "regional", "trail", "novel", "code", "somehow", "organize", "jury", "breast", "iraqi", "human", "acknowledge", "theme", "storm", "union", "record", "desk", "fear", "thanks", "fruit", "under", "expensive", "yellow", "conclusion", "prime", "shadow", "struggle", "conclude", "analyst", "dance", "limit", "like", "regulation", "being", "last", "ring", "largely", "shift", "revenue", "mark", "locate", "county", "appearance", "package", "difficulty", "bridge", "recommend", "obvious", "train", "basically", "e-mail", "generate", "anymore", "propose", "thinking", "possibly", "trend", "visitor", "loan", "currently", "comfortable", "investor", "but", "profit", "angry", "crew", "deep", "accident", "male", "meal", "hearing", "traffic", "muscle", "notion", "capture", "prefer", "truly", "earth", "japanese", "chest", "search", "thick", "cash", "museum", "beauty", "emergency", "unique", "feature", "internal", "ethnic", "link", "stress", "content", "select", "root", "nose", "declare", "outside", "appreciate", "actual", "bottle", "hardly", "setting", "launch", "dress", "file", "sick", "outcome", "ad", "defend", "matter", "judge", "duty", "sheet", "ought", "ensure", "catholic", "extremely", "extent", "component", "mix", "long-term", "slow", "contrast", "zone", "wake", "challenge", "airport", "chief", "brown", "standard", "shirt", "pilot", "warn", "ultimately", "cat", "contribution", "capacity", "ourselves", "estate", "guide", "circumstance", "snow", "english", "politician", "steal", "pursue", "slip", "percentage", "meat", "funny", "neither", "soil", "influence", "surgery", "correct", "jewish", "blame", "estimate", "due", "basketball", "late", "golf", "investigate", "crazy", "significantly", "chain", "address", "branch", "combination", "just", "frequently", "governor", "relief", "user", "dad", "kick", "part", "manner", "ancient", "silence", "rating", "golden", "motion", "german", "gender", "solve", "fee", "landscape", "used", "bowl", "equal", "long", "official", "forth", "frame", "typical", "except", "conservative", "eliminate", "host", "hall", "trust", "ocean", "score", "row", "producer", "afford", "meanwhile", "regime", "division", "confirm", "fix", "appeal", "mirror", "tooth", "smart", "length", "entirely", "rely", "topic", "complain", "issue", "variable", "back", "range", "telephone", "perception", "attract", "confidence", "bedroom", "secret", "debt", "rare", "his", "tank", "nurse", "coverage", "opposition", "aside", "anywhere", "bond", "file", "pleasure", "master", "era", "requirement", "check", "stand", "fun", "expectation", "wing", "separate", "now", "clear", "struggle", "mean", "somewhat", "pour", "stir", "judgment", "clean", "except", "beer", "english", "reference", "tear", "doubt", "grant", "seriously", "account", "minister", "totally", "hero", "industrial", "cloud", "stretch", "winner", "volume", "travel", "seed", "surprised", "rest", "fashion", "pepper", "separate", "busy", "intervention", "copy", "tip", "below", "cheap", "aim", "cite", "welfare", "vegetable", "gray", "dish", "beach", "improvement", "everywhere", "opening", "overall", "divide", "initial", "terrible", "oppose", "contemporary", "route", "multiple", "essential", "question", "league", "criminal", "careful", "core", "upper", "rush", "necessarily", "specifically", "tired", "rise", "tie", "employ", "holiday", "dance", "vast", "resolution", "household", "fewer", "abortion", "apart", "witness", "match", "barely", "sector", "representative", "lack", "beneath", "beside", "black", "incident", "limited", "proud", "flow", "faculty", "increased", "waste", "merely", "mass", "emphasize", "experiment", "definitely", "bomb", "enormous", "tone", "liberal", "massive", "engineer", "wheel", "female", "decline", "invest", "promise", "cable", "towards", "expose", "rural", "aids", "jew", "narrow", "cream", "secretary", "gate", "solid", "hill", "typically", "noise", "grass", "unfortunately", "hat", "legislation", "succeed", "either", "celebrate", "achievement", "fishing", "drink", "accuse", "hand", "useful", "land", "secret", "reject", "talent", "taste", "characteristic", "milk", "escape", "cast", "sentence", "unusual", "closely", "convince", "height", "physician", "assess", "sleep", "plenty", "ride", "virtually", "first", "addition", "sharp", "creative", "lower", "behind", "approve", "explanation", "outside", "gay", "campus", "proper", "live", "guilty", "living", "acquire", "compete", "technical", "plus", "mind", "potential", "immigrant", "weak", "illegal", "hi", "alternative", "interaction", "column", "personality", "signal", "curriculum", "list", "honor", "passenger", "assistance", "forever", "fun", "regard", "israeli", "association", "twenty", "knock", "review", "wrap", "lab", "offer", "display", "criticism", "asset", "depression", "spiritual", "musical", "journalist", "prayer", "suspect", "scholar", "warning", "climate", "cheese", "observation", "childhood", "payment", "sir", "permit", "cigarette", "definition", "priority", "bread", "creation", "graduate", "request", "emotion", "scream", "dramatic", "universe", "gap", "excellent", "deeply", "prosecutor", "mark", "green", "lucky", "drag", "airline", "library", "agenda", "recover", "factory", "selection", "primarily", "roof", "unable", "expense", "initiative", "diet", "arrest", "funding", "therapy", "wash", "schedule", "sad", "brief", "housing", "post", "purchase", "existing", "dark", "steel", "regarding", "shout", "remaining", "visual", "fairly", "chip", "violent", "silent", "suppose", "self", "bike", "tea", "perceive", "comparison", "settlement", "layer", "planning", "far", "description", "later", "slow", "slide", "widely", "wedding", "inform", "portion", "territory", "immediate", "opponent", "abandon", "link", "mass", "lake", "transform", "tension", "display", "leading", "bother", "consist", "alcohol", "enable", "bend", "saving", "gain", "desert", "shall", "error", "release", "cop", "arab", "double", "walk", "sand", "spanish", "rule", "hit", "print", "preserve", "passage", "formal", "transition", "existence", "album", "participation", "arrange", "atmosphere", "joint", "reply", "cycle", "opposite", "lock", "whole", "deserve", "consistent", "resistance", "discovery", "tear", "exposure", "pose", "stream", "sale", "trust", "benefit", "pot", "grand", "mine", "hello", "coalition", "tale", "knife", "resolve", "racial", "phase", "present", "joke", "coat", "mexican", "symptom", "contact", "manufacturer", "philosophy", "potato", "interview", "foundation", "quote", "online", "pass", "negotiation", "good", "urge", "occasion", "dust", "breathe", "elect", "investigator", "jacket", "glad", "ordinary", "reduction", "rarely", "shift", "pack", "suicide", "numerous", "touch", "substance", "discipline", "elsewhere", "iron", "practical", "moreover", "passion", "volunteer", "implement", "essentially", "gene", "enforcement", "vs", "sauce", "independence", "marketing", "priest", "amazing", "intense", "advance", "employer", "shock", "inspire", "adjust", "retire", "sure", "visible", "kiss", "illness", "cap", "habit", "competitive", "juice", "congressional", "involvement", "dominate", "previously", "whenever", "transfer", "analyze", "another", "attach", "for", "indian", "disaster", "parking", "prospect", "boss", "complaint", "championship", "coach", "exercise", "fundamental", "severe", "enhance", "mystery", "impose", "poverty", "other", "entry", "fat", "spending", "king", "evaluate", "symbol", "still", "trade", "maker", "mood", "accomplish", "emphasis", "illustrate", "boot", "monitor", "asian", "entertainment", "bean", "evaluation", "creature", "commander", "digital", "arrangement", "concentrate", "total", "usual", "anger", "psychological", "heavily", "peak", "approximately", "increasing", "disorder", "missile", "equally", "vary", "wire", "round", "distribution", "transportation", "holy", "ring", "twin", "command", "commission", "interpretation", "breakfast", "stop", "strongly", "engineering", "luck", "so-called", "constant", "race", "clinic", "veteran", "smell", "tablespoon", "capable", "nervous", "tourist", "light", "toss", "crucial", "bury", "pray", "tomato", "exception", "butter", "deficit", "bathroom", "objective", "block", "electronic", "ally", "journey", "reputation", "mixture", "surely", "tower", "smoke", "confront", "pure", "glance", "dimension", "toy", "prisoner", "fellow", "smooth", "nearby", "peer", "designer", "personnel", "shape", "educator", "relative", "immigration", "belt", "teaspoon", "birthday", "implication", "perfectly", "coast", "supporter", "accompany", "silver", "teenager", "recognition", "retirement", "flag", "recovery", "whisper", "watch", "gentleman", "corn", "moon", "inner", "junior", "rather", "throat", "salary", "swing", "observer", "due", "straight", "publication", "pretty", "crop", "dig", "strike", "permanent", "plant", "phenomenon", "anxiety", "unlike", "wet", "literally", "resist", "convention", "embrace", "supply", "assist", "exhibition", "construct", "viewer", "pan", "consultant", "soon", "line", "administrator", "date", "occasionally", "mayor", "consideration", "ceo", "secure", "pink", "smoke", "estimate", "buck", "historic", "poem", "grandmother", "bind", "fifth", "constantly", "enterprise", "favor", "testing", "stomach", "apparent", "weigh", "install", "sensitive", "suggestion", "mail", "recipe", "reasonable", "preparation", "wooden", "elementary", "concert", "aggressive", "false", "intention", "channel", "extreme", "tube", "drawing", "protein", "quit", "absence", "roll", "latin", "rapidly", "jail", "comment", "diversity", "honest", "palestinian", "pace", "employment", "speaker", "impression", "essay", "respondent", "giant", "cake", "historian", "negotiate", "restore", "substantial", "pop", "particular", "specialist", "origin", "approval", "mine", "quietly", "advise", "conventional", "drop", "count", "depth", "wealth", "disability", "shell", "general", "criticize", "fast", "professional", "effectively", "biological", "pack", "onion", "deputy", "flat", "brand", "assure", "mad", "award", "criteria", "dealer", "via", "alternative", "utility", "precisely", "arise", "armed", "nevertheless", "highway", "clinical", "routine", "schedule", "wage", "normally", "phrase", "ingredient", "stake", "muslim", "dream", "fiber", "activist", "islamic", "snap", "terrorism", "refugee", "incorporate", "hip", "ultimate", "switch", "corporation", "valuable", "assumption", "gear", "graduate", "barrier", "minor", "provision", "killer", "assign", "gang", "developing", "classic", "chemical", "wave", "label", "teen", "index", "vacation", "advocate", "draft", "extraordinary", "heaven", "rough", "yell", "pregnant", "distant", "drama", "satellite", "personally", "wonder", "clock", "chocolate", "italian", "canadian", "ceiling", "sweep", "advertising", "universal", "spin", "house", "button", "bell", "rank", "darkness", "ahead", "clothing", "super", "yield", "fence", "portrait", "paint", "survival", "roughly", "lawsuit", "bottom", "testimony", "bunch", "beat", "wind", "found", "burden", "react", "chamber", "furniture", "cooperation", "string", "ceremony", "communicate", "taste", "cheek", "lost", "profile", "mechanism", "disagree", "like", "penalty", "match", "ie", "advance", "resort", "destruction", "bear", "unlikely", "tissue", "constitutional", "pant", "stranger", "infection", "cabinet", "broken", "apple", "electric", "proceed", "track", "bet", "literary", "virus", "stupid", "dispute", "fortune", "strategic", "assistant", "overcome", "remarkable", "occupy", "statistics", "shopping", "cousin", "encounter", "wipe", "initially", "blind", "white", "port", "honor", "electricity", "genetic", "adviser", "pay", "spokesman", "retain", "latter", "incentive", "slave", "chemical", "translate", "accurate", "whereas", "terror", "though", "expansion", "elite", "olympic", "dirt", "odd", "rice", "bullet", "tight", "bible", "chart", "solar", "decline", "conservative", "process", "square", "stick", "concentration", "complicated", "gently", "champion", "scenario", "telescope", "reflection", "revolution", "strip", "interpret", "friendly", "tournament", "fiction", "detect", "balance", "likely", "tremendous", "lifetime", "recommendation", "flow", "senator", "market", "hunting", "salad", "guarantee", "innocent", "boundary", "pause", "remote", "satisfaction", "journal", "bench", "lover", "raw", "awareness", "surprising", "withdraw", "general", "deck", "similarly", "newly", "pole", "testify", "mode", "dialogue", "imply", "naturally", "mutual", "founder", "top", "advanced", "pride", "dismiss", "aircraft", "delivery", "mainly", "bake", "freeze", "platform", "finance", "sink", "attractive", "respect", "diverse", "relevant", "ideal", "joy", "worth", "regularly", "working", "singer", "evolve", "shooting", "partly", "unknown", "assistant", "offense", "counter", "dna", "smell", "potentially", "transfer", "thirty", "justify", "protest", "crash", "craft", "treaty", "terrorist", "insight", "possess", "politically", "tap", "lie", "extensive", "episode", "double", "swim", "tire", "fault", "loose", "free", "shortly", "originally", "considerable", "prior", "intellectual", "mix", "assault", "relax", "stair", "adventure", "external", "proof", "confident", "headquarters", "sudden", "dirty", "violation", "tongue", "license", "hold", "shelter", "rub", "controversy", "entrance", "favorite", "practice", "properly", "fade", "defensive", "tragedy", "net", "characterize", "funeral", "profession", "alter", "spot", "constitute", "establishment", "squeeze", "imagination", "target", "mask", "convert", "comprehensive", "prominent", "presentation", "regardless", "easy", "load", "stable", "introduction", "appeal", "pretend", "not", "elderly", "representation", "deer", "split", "violate", "partnership", "pollution", "emission", "steady", "vital", "neither", "fate", "earnings", "oven", "distinction", "segment", "nowhere", "poet", "mere", "exciting", "variation", "comfort", "radical", "stress", "adapt", "irish", "honey", "correspondent", "pale", "musician", "significance", "load", "round", "vessel", "storage", "flee", "mm-hmm", "leather", "distribute", "evolution", "ill", "tribe", "shelf", "can", "grandfather", "lawn", "buyer", "dining", "wisdom", "council", "vulnerable", "instance", "garlic", "capability", "poetry", "celebrity", "gradually", "stability", "doubt", "fantasy", "scared", "guide", "plot", "framework", "gesture", "depending", "ongoing", "psychology", "since", "counselor", "witness", "chapter", "fellow", "divorce", "owe", "pipe", "athletic", "slight", "math", "shade", "tail", "sustain", "mount", "obligation", "angle", "palm", "differ", "custom", "store", "economist", "fifteen", "soup", "celebration", "efficient", "damage", "composition", "satisfy", "pile", "briefly", "carbon", "closer", "consume", "scheme", "crack", "frequency", "tobacco", "survivor", "besides", "in", "psychologist", "wealthy", "galaxy", "given", "fund", "ski", "limitation", "ok", "trace", "appointment", "preference", "meter", "explosion", "arrest", "publicly", "incredible", "fighter", "rapid", "admission", "hunter", "educate", "painful", "friendship", "aide", "infant", "calculate", "fifty", "rid", "porch", "tendency", "uniform", "formation", "scholarship", "reservation", "efficiency", "waste", "qualify", "mall", "derive", "scandal", "pc", "helpful", "impress", "heel", "resemble", "privacy", "fabric", "surprise", "contest", "proportion", "guideline", "rifle", "maintenance", "conviction", "trick", "organic", "tent", "examination", "publisher", "strengthen", "french", "proposed", "myth", "sophisticated", "cow", "etc", "standing", "asleep", "tennis", "nerve", "barrel", "bombing", "membership", "ratio", "menu", "purchase", "controversial", "desperate", "rate", "lifestyle", "humor", "loud", "glove", "suspect", "sufficient", "narrative", "photographer", "helicopter", "catholic", "modest", "provider", "delay", "agricultural", "explode", "stroke", "scope", "punishment", "handful", "badly", "horizon", "curious", "downtown", "girlfriend", "prompt", "request", "cholesterol", "absorb", "adjustment", "taxpayer", "eager", "principal", "detailed", "motivation", "assignment", "restriction", "across", "palestinian", "laboratory", "workshop", "differently", "auto", "romantic", "cotton", "motor", "sue", "flavor", "overlook", "float", "undergo", "sequence", "demonstration", "jet", "orange", "consumption", "assert", "blade", "temporary", "medication", "print", "cabin", "bite", "relative", "edition", "valley", "yours", "pitch", "pine", "brilliant", "versus", "manufacturing", "risk", "christian", "complex", "absolute", "chef", "discrimination", "offensive", "german", "suit", "boom", "register", "appoint", "heritage", "god", "terrorist", "dominant", "successfully", "shit", "lemon", "hungry", "sense", "dry", "wander", "submit", "economics", "naked", "anticipate", "nut", "legacy", "extension", "shrug", "fly", "battery", "arrival", "legitimate", "orientation", "inflation", "cope", "flame", "cluster", "host", "wound", "dependent", "shower", "institutional", "depict", "operating", "flesh", "garage", "operator", "instructor", "collapse", "borrow", "furthermore", "comedy", "mortgage", "sanction", "civilian", "twelve", "weekly", "habitat", "grain", "brush", "consciousness", "devote", "crack", "measurement", "province", "ease", "seize", "ethics", "nomination", "permission", "wise", "actress", "summit", "acid", "odds", "gifted", "frustration", "medium", "function", "physically", "grant", "distinguish", "shore", "repeatedly", "lung", "firm", "running", "correct", "distinct", "artistic", "discourse", "basket", "ah", "fighting", "impressive", "competitor", "ugly", "worried", "portray", "powder", "ghost", "persuade", "moderate", "subsequent", "continued", "cookie", "carrier", "cooking", "frequent", "ban", "swing", "orange", "awful", "admire", "pet", "miracle", "exceed", "rhythm", "widespread", "killing", "lovely", "sin", "charity", "script", "tactic", "identification", "transformation", "everyday", "headline", "crash", "venture", "invasion", "military", "nonetheless", "adequate", "piano", "grocery", "intensity", "exhibit", "high", "blanket", "margin", "principal", "quarterback", "mouse", "rope", "concrete", "prescription", "african-american", "chase", "document", "brick", "recruit", "patch", "consensus", "horror", "recording", "changing", "painter", "colonial", "pie", "sake", "gaze", "courage", "pregnancy", "swear", "defeat", "clue", "reinforce", "win", "confusion", "slice", "occupation", "dear", "coal", "sacred", "criminal", "formula", "cognitive", "collective", "exact", "uncle", "square", "captain", "sigh", "attribute", "dare", "okay", "homeless", "cool", "gallery", "soccer", "defendant", "tunnel", "fitness", "lap", "grave", "toe", "container", "virtue", "abroad", "architect", "dramatically", "makeup", "inquiry", "rose", "surprisingly", "highlight", "decrease", "indication", "rail", "anniversary", "couch", "alliance", "hypothesis", "boyfriend", "compose", "peer", "mess", "rank", "legend", "regulate", "adolescent", "shine", "norm", "upset", "remark", "resign", "reward", "gentle", "related", "organ", "lightly", "concerning", "invent", "laughter", "fit", "northwest", "counseling", "tight", "receiver", "ritual", "insect", "interrupt", "salmon", "favor", "trading", "concern", "magic", "superior", "combat", "stem", "surgeon", "acceptable", "physics", "rape", "counsel", "brush", "jeans", "hunt", "continuous", "log", "echo", "pill", "excited", "sculpture", "compound", "integrate", "flour", "bitter", "bare", "slope", "rent", "presidency", "serving", "subtle", "greatly", "bishop", "drinking", "delay", "cry", "acceptance", "collapse", "shop", "pump", "candy", "evil", "final", "finance", "pleased", "medal", "beg", "sponsor", "ethical", "secondary", "slam", "export", "experimental", "melt", "midnight", "net", "curve", "integrity", "entitle", "evident", "logic", "essence", "park", "exclude", "harsh", "closet", "suburban", "greet", "favor", "interior", "corridor", "murder", "retail", "pitcher", "march", "snake", "pitch", "excuse", "cross", "weakness", "pig", "cold", "classical", "estimated", "t-shirt", "online", "unemployment", "civilization", "fold", "patient", "pop", "daily", "reverse", "missing", "correlation", "humanity", "flash", "developer", "reliable", "excitement", "beef", "islam", "roman", "stretch", "architecture", "occasional", "administrative", "elbow", "deadly", "muslim", "hispanic", "allegation", "tip", "confuse", "airplane", "monthly", "duck", "dose", "korean", "plead", "initiate", "lecture", "van", "sixth", "bay", "mainstream", "suburb", "sandwich", "unlike", "trunk", "rumor", "implementation", "swallow", "motivate", "render", "longtime", "trap", "restrict", "cloth", "seemingly", "legislative", "effectiveness", "enforce", "lens", "reach", "inspector", "lend", "plain", "fraud", "companion", "contend", "nail", "array", "strict", "assemble", "frankly", "rat", "burst", "hallway", "cave", "inevitable", "southwest", "monster", "speed", "protest", "unexpected", "obstacle", "facilitate", "encounter", "rip", "herb", "overwhelming", "integration", "crystal", "recession", "wish", "top", "written", "motive", "label", "flood", "pen", "ownership", "nightmare", "notice", "inspection", "supervisor", "consult", "arena", "laugh", "diagnosis", "possession", "forgive", "warm", "consistently", "basement", "project", "drift", "drain", "last", "prosecution", "maximum", "announcement", "warrior", "prediction", "bacteria", "questionnaire", "mud", "infrastructure", "hurry", "privilege", "temple", "medium", "outdoor", "suck", "broadcast", "re", "leap", "random", "past", "wrist", "curtain", "monitor", "pond", "domain", "guilt", "cattle", "subject", "walking", "playoff", "minimum", "fiscal", "skirt", "dump", "hence", "database", "uncomfortable", "aim", "execute", "limb", "ideology", "average", "welcome", "tune", "continuing", "harm", "railroad", "endure", "radiation", "horn", "chronic", "peaceful", "innovation", "strain", "guitar", "replacement", "behave", "administer", "simultaneously", "dancer", "amendment", "guard", "pad", "transmission", "await", "retired", "trigger", "spill", "grateful", "grace", "virtual", "response", "colony", "adoption", "slide", "indigenous", "closed", "convict", "civilian", "towel", "modify", "particle", "award", "glance", "prize", "landing", "conduct", "blue", "boost", "bat", "alarm", "festival", "grip", "weird", "undermine", "freshman", "sweat", "outer", "european", "drunk", "survey", "research", "separation", "traditionally", "stuff", "govern", "southeast", "intelligent", "wherever", "ballot", "rhetoric", "convinced", "driving", "vitamin", "enthusiasm", "accommodate", "praise", "injure", "wilderness", "nearby", "endless", "hay", "pause", "excuse", "respectively", "uncertainty", "chaos", "short", "mechanical", "canvas", "forty", "matter", "lobby", "profound", "format", "trait", "currency", "turkey", "reserve", "beam", "abuse", "astronomer", "corruption", "contractor", "apologize", "doctrine", "genuine", "thumb", "unity", "compromise", "horrible", "behavioral", "exclusive", "scatter", "commonly", "convey", "rush", "twist", "complexity", "fork", "disk", "relieve", "suspicion", "lock", "finish", "residence", "shame", "meaningful", "sidewalk", "olympics", "technological", "signature", "pleasant", "wow", "suspend", "rebel", "frozen", "desire", "spouse", "fluid", "pension", "resume", "theoretical", "sodium", "blow", "promotion", "delicate", "forehead", "rebuild", "bounce", "electrical", "hook", "detective", "traveler", "click", "compensation", "signal", "exit", "attraction", "dedicate", "altogether", "pickup", "carve", "needle", "belly", "ship", "scare", "portfolio", "shuttle", "invisible", "timing", "engagement", "ankle", "transaction", "rescue", "counterpart", "historically", "firmly", "mild", "rider", "doll", "noon", "exhibit", "amid", "identical", "precise", "anxious", "structural", "residential", "loud", "diagnose", "carbohydrate", "liberty", "poster", "theology", "nonprofit", "crawl", "oxygen", "handsome", "magic", "sum", "provided", "businessman", "promising", "conscious", "determination", "donor", "hers", "pastor", "jazz", "opera", "japanese", "bite", "frame", "evil", "acquisition", "pit", "hug", "wildlife", "punish", "giant", "primary", "equity", "wrong", "doorway", "departure", "elevator", "teenage", "guidance", "happiness", "statue", "pursuit", "repair", "decent", "gym", "oral", "clerk", "israeli", "envelope", "reporting", "destination", "fist", "endorse", "exploration", "generous", "bath", "rescue", "thereby", "overall", "indicator", "sunlight", "feedback", "spectrum", "purple", "laser", "bold", "reluctant", "starting", "expertise", "practically", "program", "picture", "tune", "eating", "age", "volunteer", "hint", "sharply", "parade", "advocate", "realm", "ban", "strip", "cancel", "blend", "therapist", "slice", "peel", "pizza", "recipient", "hesitate", "flip", "accounting", "debate", "bias", "huh", "metaphor", "candle", "handle", "worry", "judicial", "entity", "suffering", "full-time", "feel", "lamp", "garbage", "servant", "addition", "regulatory", "diplomatic", "elegant", "inside", "reception", "vanish", "automatically", "chin", "trail", "necessity", "confess", "racism", "starter", "interior", "banking", "casual", "gravity", "enroll", "diminish", "prevention", "arab", "value", "minimize", "chop", "performer", "intent", "isolate", "pump", "inventory", "productive", "assembly", "civic", "silk", "magnitude", "steep", "hostage", "collector", "popularity", "kiss", "alien", "dynamic", "scary", "equation", "angel", "switch", "offering", "rage", "photography", "repair", "toilet", "disappointed", "precious", "prohibit", "representative", "content", "realistic", "russian", "hidden", "command", "tender", "wake", "gathering", "outstanding", "stumble", "lonely", "automobile", "artificial", "dawn", "abstract", "descend", "silly", "hook", "tide", "shared", "hopefully", "readily", "cooperate", "revolutionary", "romance", "hardware", "pillow", "kit", "cook", "spread", "continent", "seal", "circuit", "sink", "ruling", "shortage", "annually", "lately", "trap", "scan", "fool", "deadline", "rear", "processing", "ranch", "coastal", "undertake", "softly", "reserve", "burning", "verbal", "tribal", "ridiculous", "automatic", "diamond", "credibility", "import", "sexually", "spring", "way", "divine", "sentiment", "cart", "oversee", "stem", "elder", "pro", "inspiration", "dutch", "quantity", "trailer", "mate", "o'clock", "greek", "genius", "monument", "bid", "quest", "sacrifice", "invitation", "accuracy", "juror", "officially", "broker", "treasure", "loyalty", "credit", "shock", "talented", "gasoline", "stiff", "output", "nominee", "extended", "please", "diabetes", "slap", "toxic", "alleged", "jaw", "grief", "mysterious", "rocket", "donate", "inmate", "tackle", "dynamics", "bow", "ours", "senior", "dignity", "carpet", "parental", "bubble", "heat", "buddy", "barn", "sword", "flash", "seventh", "glory", "tightly", "protective", "tuck", "drum", "faint", "post", "queen", "dilemma", "input", "specialize", "northeast", "shallow", "liability", "sail", "merchant", "stadium", "improved", "bloody", "defeat", "associated", "withdrawal", "refrigerator", "nest", "near", "thoroughly", "lane", "ancestor", "condemn", "steam", "accent", "escape", "optimistic", "unite", "cage", "equip", "shrimp", "homeland", "exchange", "rack", "costume", "wolf", "courtroom", "statute", "cartoon", "besides", "productivity", "grin", "symbolic", "seal", "bug", "bless", "aunt", "agriculture", "rock", "hostile", "root", "conceive", "combined", "instantly", "bankruptcy", "vaccine", "bonus", "collaboration", "mixed", "opposed", "orbit", "grasp", "patience", "spite", "tropical", "voting", "patrol", "willingness", "position", "revelation", "rent", "calm", "jewelry", "cuban", "haul", "concede", "trace", "wagon", "afterward", "spectacular", "ruin", "sheer", "prior", "immune", "reliability", "ass", "alongside", "bush", "exotic", "fascinating", "secure", "clip", "thigh", "bull", "drawer", "regard", "sheep", "discourage", "coordinator", "ideological", "runner", "secular", "intimate", "empire", "cab", "divorce", "exam", "documentary", "neutral", "biology", "flexible", "progressive", "web", "conspiracy", "catch", "casualty", "republic", "execution", "terrific", "whale", "functional", "star", "draft", "instinct", "teammate", "aluminum", "whoever", "ministry", "verdict", "instruct", "skull", "self-esteem", "ease", "cooperative", "manipulate", "bee", "practitioner", "loop", "edit", "whip", "puzzle", "mushroom", "subsidy", "boil", "tragic", "mathematics", "mechanic", "jar", "respect", "earthquake", "pork", "creativity", "safely", "underlying", "dessert", "sympathy", "fisherman", "incredibly", "isolation", "sock", "near", "jump", "eleven", "sexy", "entrepreneur", "syndrome", "bureau", "seat", "workplace", "ambition", "touchdown", "utilize", "breeze", "costly", "ambitious", "christianity", "presumably", "influential", "translation", "uncertain", "dissolve", "object", "statistical", "gut", "metropolitan", "rolling", "aesthetic", "spell", "insert", "booth", "helmet", "waist", "expected", "lion", "accomplishment", "royal", "panic", "cast", "crush", "actively", "cliff", "minimal", "cord", "fortunately", "cocaine", "illusion", "anonymous", "tolerate", "appreciation", "commissioner", "harm", "flexibility", "instructional", "scramble", "casino", "tumor", "decorate", "sort", "charge", "pulse", "equivalent", "fixed", "experienced", "donation", "diary", "sibling", "irony", "spoon", "midst", "alley", "upset", "interact", "soap", "cute", "rival", "short-term", "punch", "pin", "hockey", "passing", "persist", "supplier", "known", "momentum", "purse", "shed", "liquid", "icon", "elephant", "consequently", "legislature", "associate", "franchise", "correctly", "mentally", "foster", "bicycle", "encouraging", "cheat", "access", "heal", "fever", "filter", "rabbit", "coin", "exploit", "accessible", "organism", "sensation", "partially", "stay", "upstairs", "dried", "minimum", "pro", "conservation", "shove", "backyard", "charter", "stove", "consent", "comprise", "reminder", "alike", "placement", "dough", "grandchild", "dam", "reportedly", "well-known", "surrounding", "ecological", "outfit", "unprecedented", "columnist", "workout", "preliminary", "patent", "shy", "quote", "trash", "disabled", "gross", "damn", "hormone", "texture", "counter", "pencil", "associate", "frontier", "spray", "bet", "disclose", "custody", "banker", "beast", "interfere", "oak", "case", "eighth", "notebook", "outline", "gaze", "attendance", "speculation", "uncover", "behalf", "innovative", "shark", "reward", "mill", "installation", "stimulate", "tag", "vertical", "swimming", "fleet", "catalog", "outsider", "sacrifice", "desperately", "stance", "compel", "sensitivity", "someday", "instant", "debut", "proclaim", "worldwide", "hike", "required", "confrontation", "colorful", "ideal", "constitution", "trainer", "thanksgiving", "scent", "stack", "eyebrow", "sack", "cease", "inherit", "tray", "pioneer", "organizational", "textbook", "uh", "nasty", "shrink", "model", "emerging", "dot", "wheat", "fierce", "envision", "rational", "kingdom", "aisle", "weaken", "protocol", "exclusively", "vocal", "marketplace", "openly", "unfair", "terrain", "deploy", "risky", "pasta", "genre", "distract", "merit", "planner", "depressed", "chunk", "closest", "discount", "no", "ladder", "jungle", "migration", "breathing", "invade", "hurricane", "retailer", "classify", "wound", "coup", "aid", "ambassador", "density", "supportive", "curiosity", "skip", "aggression", "stimulus", "journalism", "robot", "flood", "dip", "likewise", "informal", "persian", "feather", "sphere", "tighten", "boast", "pat", "perceived", "sole", "publicity", "major", "unfold", "joke", "well-being", "validity", "ecosystem", "strictly", "partial", "collar", "weed", "compliance", "streak", "supposedly", "added", "builder", "glimpse", "premise", "specialty", "deem", "artifact", "sneak", "monkey", "mentor", "two-thirds", "listener", "lightning", "legally", "sleeve", "disappointment", "disturb", "rib", "excessive", "high-tech", "debris", "pile", "rod", "logical", "liberal", "ash", "socially", "parish", "slavery", "blank", "commodity", "cure", "mineral", "hunger", "dying", "developmental", "faster", "spare", "halfway", "cure", "equality", "cemetery", "harassment", "deliberately", "fame", "regret", "striking", "likelihood", "carrot", "atop", "toll", "rim", "embarrassed", "fucking", "cling", "isolated", "blink", "suspicious", "wheelchair", "squad", "eligible", "processor", "plunge", "this", "sponsor", "grin", "color", "demographic", "rain", "chill", "refuge", "steer", "legislator", "rally", "programming", "cheer", "outlet", "intact", "vendor", "thrive", "peanut", "chew", "elaborate", "intellectual", "conception", "auction", "steak", "comply", "triumph", "shareholder", "comparable", "transport", "conscience", "calculation", "considerably", "interval", "scratch", "awake", "jurisdiction", "inevitably", "feminist", "constraint", "emotionally", "expedition", "allegedly", "compromise", "strain", "similarity", "butt", "lid", "dumb", "bulk", "sprinkle", "mortality", "philosophical", "conversion", "patron", "municipal", "any", "liver", "harmony", "solely", "tolerance", "instant", "goat", "arm", "blessing", "banana", "running", "palace", "formerly", "peasant", "neat", "grandparent", "lawmaker", "supermarket", "cruise", "mobile", "plain", "part", "calendar", "widow", "deposit", "beard", "brake", "downtown", "screening", "impulse", "forbid", "fur", "brutal", "predator", "poke", "opt", "voluntary", "trouble", "valid", "forum", "dancing", "happily", "soar", "removal", "autonomy", "enact", "round", "thread", "light", "landmark", "unhappy", "offender", "coming", "privately", "fraction", "distinctive", "tourism", "threshold", "calm", "routinely", "suite", "remark", "regulator", "straw", "theological", "apart", "exhaust", "globe", "fragile", "objection", "chemistry", "old-fashioned", "crowded", "circle", "blast", "prevail", "overnight", "denial", "rental", "fantastic", "fragment", "level", "screw", "warmth", "undergraduate", "liquid", "headache", "policeman", "yield", "projection", "battle", "suitable", "mention", "graduation", "drill", "cruel", "mansion", "regard", "grape", "authorize", "cottage", "driveway", "charm", "sexuality", "loyal", "clay", "pound", "balloon", "invention", "ego", "fare", "homework", "disc", "sofa", "guarantee", "availability", "radar", "frown", "regain", "leave", "permit", "sweater", "rehabilitation", "rubber", "retreat", "molecule", "freely", "favorable", "steadily", "veteran", "integrated", "ha", "youngster", "broadcast", "premium", "accountability", "overwhelm", "one-third", "contemplate", "update", "spark", "ironically", "fatigue", "beyond", "speculate", "marker", "low", "preach", "bucket", "bomb", "blond", "confession", "provoke", "marble", "substantially", "twist", "defender", "fish", "explicit", "transport", "disturbing", "surveillance", "magnetic", "technician", "mutter", "devastating", "depart", "arrow", "trauma", "neighboring", "soak", "ribbon", "meantime", "transmit", "screen", "harvest", "consecutive", "republican", "coordinate", "worldwide", "within", "spy", "slot", "riot", "nutrient", "citizenship", "severely", "sovereignty", "ridge", "brave", "lighting", "specify", "contributor", "frustrate", "crowd", "articulate", "importantly", "transit", "dense", "seminar", "electronics", "sunny", "shorts", "swell", "accusation", "soften", "photograph", "straighten", "terribly", "cue", "sudden", "bride", "biography", "hazard", "compelling", "seldom", "tile", "economically", "honestly", "troubled", "bow", "twentieth", "balanced", "foreigner", "launch", "convenience", "delight", "weave", "timber", "till", "accurately", "plea", "bulb", "copy", "flying", "sustainable", "devil", "bolt", "cargo", "spine", "seller", "skilled", "managing", "public", "marine", "dock", "organized", "fog", "diplomat", "boring", "sometime", "summary", "missionary", "epidemic", "fatal", "trim", "warehouse", "accelerate", "butterfly", "bronze", "drown", "inherent", "praise", "nationwide", "spit", "harvest", "kneel", "vacuum", "selected", "dictate", "stereotype", "sensor", "laundry", "manual", "pistol", "naval", "plaintiff", "kid", "middle-class", "apology", "till"];