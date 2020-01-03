let story_db = {};
let global_tables = {};
let local_tables = {};
local_tables.favorite = false;
local_tables.your = false;
let queued_rates = [];
let queued_titles = [];
let queued_stories = [];
// let all_user_names = [];

const punc = [".", ",", "!", "?"];
const warning_message = { "title": "Warning", "message": "Several of your submissions have been rejected by other users. Please ensure you are making quality submissions!", "timestamp": 0 };
const in_progress_string = '<span class="progress">in progress</span>';
const default_title = "Basher! Write One Word Of The Next Great Story";
let my_photo_url = "https://basher.app/images/user.png";

// DIp switches
const max_demerit_percentage = 50; // not server enforced
const number_of_messages = 10;
const limit_count = 100; // firebase rule 
const stories_per_page = 25; // 4 pages
const recent_user_count = 24; // firebase rule
const score_to_stories_ratio = 50 * 5; // 25 words -- firebase rule (currently at 100)
const number_of_recent_words = 10;
const minimum_story_length = 29; // 49? -- firebase rule
const max_title_length = 30; // firebase rule
const tweet_vote_threshold = 25; // firebase and index
const tweet_rating_threshold = 4; // firebase andindex -- not used rn
const rates_and_titles_limit = 25;


// Checks if user meant to submmit non dictionary word
let are_you_sure = last_entry = "";

// TUrn off snapshots. make them blank just in case they get called at wrong time
let stop_score = function() {};
let stop_story = function() {};
let stop_queue = function() {};
let stop_messages = function() {};

let messages_data = global_user = user_stories = queue_loaded = top_stories_loaded = recent_stories_loaded = loading = load_when_finshed = on_dead_queue = warning_shown = flag_end_confirmation = user_has_messages = schema_generated = profile_is_loaded = false;

// Tracks queue - Tracks Which story in your personal queue you're on - Tracks when you get to start
let counter = {
    queue: 0, // where ou are in the queue
    story: 0, // within your personal story queue
    start: 0, // how many start_stories you've done
    rate: 0, // how many ratings youve done (gets x at a time)
    title: 0 // how many titles youve done (gets x at a time)

};


let load_ad = {
    "queue": { "page1": true },
    "recent_stories_page": { "page1": true },
    "top_stories_page": { "page1": true },
    "story": { "page1": true }
};


// For detecting errors with uploading new profile images.
let new_profile_pic = new Image();

// Queue
const writes = 10; // 40 words 
const rates = 1; // 5 ratings 
const titles = 1; // 5 votes
const starts = 1; // ? new stories. Only works when available. (score / created > 30 ) match on RULES


// Queue Order
const queue_write = 0;
const queue_rate = queue_write + writes;
const queue_title = queue_rate + rates;
const queue_start = queue_title + titles;
const queue_rounds = queue_start + starts;

// Initialize Firebase

let perf = firebase.performance();
let db = firebase.firestore();
let storage = firebase.storage();
let ui = new firebaseui.auth.AuthUI(firebase.auth());
let uiConfig = {
    callbacks: {
        signInSuccessWithAuthResult: (authResult, redirectUrl) => {
            // User successfully signed in.
            $("#register").hide();
            return false;
        },
        uiShown: () => {
            document.getElementById('loader').style.display = 'none';
        }
    },

    // testing. replace with one-touch when avail.
    credentialHelper: firebaseui.auth.CredentialHelper.NONE,

    // Will use popup for IDP Providers sign-in flow instead of the default, redirect.
    signInFlow: 'popup',
    signInSuccessUrl: 'https://basher.app',
    signInOptions: [
        // Leave the lines as is for the providers you want to offer your users.
        firebase.auth.GoogleAuthProvider.PROVIDER_ID,
        {
            provider: firebase.auth.EmailAuthProvider.PROVIDER_ID,
            requireDisplayName: true
        },
        firebase.auth.FacebookAuthProvider.PROVIDER_ID,
        firebase.auth.TwitterAuthProvider.PROVIDER_ID

    ],
    // Terms of service url.
    tosUrl: 'https://basher.app/tos.html',
    // Privacy policy url.
    privacyPolicyUrl: 'https://basher.app/privacy.html'
};

ui.start('#firebaseui-auth-container', uiConfig);

// not using this callback at the moment but
let email_config = {};

db.collection("Messages").doc("global").get().then((doc) => {


    if (!doc.exists)
        return;

    messages_data = doc.data();


    process_snapshot(JSON.parse(messages_data.top_stories), "top");
    process_snapshot(JSON.parse(messages_data.recent_stories), "recent");

});

firebase.auth().onAuthStateChanged((user) => {

    // Logged in or out, we're gonna blank the user data:

    blank();

    if (user) {

        // Clones user object into our modifyable one
        global_user = $.extend(global_user, user);
        global_user.uid = firebase.auth().currentUser.uid;

        email_config = {
            url: 'https://basher.app/?email=' + global_user.email
        };

        if (!global_user.emailVerified) {
            $(".resend").show();
        }


        db.collection("Users").doc(global_user.uid).get().then((user_data) => {

            if (user_data.exists) {

                // User Has Logged In To The Site Before

                // Merge public-facing data with private auth data, public-facing takes precedence
                Object.assign(global_user, user_data.data());

                //don't used old queued stories, more will come shortly
                queued_stories = [];

                // Get User's Story Collection
                db.collection("Users").doc(global_user.uid).collection("Stories").get().then((story_collection) => {

                        story_collection.forEach((doc) => {

                            user_stories[doc.id] = doc.data();

                        })

                    }).then(() => {
                        // console.log("Got User's Story Info");

                        // Reload Top Stories to add personal stars, in case they looked before login. will reload when clicked with fresh user data.
                        top_stories_loaded = recent_stories_loaded = false;

                    })
                    .catch(log_error);

                // Tell The Server We're Logged In, Gives Points For Login

                if (gtag || false) {
                    gtag('event', global_user.providerData.length + " " + global_user.providerData[0].providerId, {
                        'event_category': 'Login'
                    });
                }

                db.collection("Users").doc(global_user.uid).set({
                        "logged_in": true
                    }, { merge: true }).then(() => {

                        // console.log("Told server we're logged in!");

                    })
                    .catch(log_error);



            } else {

                // New User!

                // The server will generate all this in a second, but let's have it now:
                global_user.score = 0;
                queued_stories = [];
                global_user.recent_words = [];
                global_user.displayName = firebase.auth().currentUser.displayName.substring(0, 15);

                if (!(global_user.photoURL || false))
                    global_user.photoURL = "https://basher.app/images/user.png";

                user.sendEmailVerification(email_config);

            }

            // All users: Get interface ready

            if (global_user.photoURL.substring(0, 5) !== "https") {

                let starsRef1 = storage.ref().child("Custom_Photos/" + global_user.photoURL);

                starsRef1.getDownloadURL().then((url) => {

                    my_photo_url = url;
                    $("user-photo.self").html('<img src="' + my_photo_url + '">');


                }).catch(log_error);

            } else {
                my_photo_url = global_user.photoURL;
                $("user-photo.self").html('<img src="' + my_photo_url + '">');
            }

            $(".user_id").html(global_user.displayName);
            $(".score").html(numberWithCommas(global_user.score));


            // Recent USers

            $("#recent_users_div").html("");

            db.collection("Users").orderBy('last_login', 'desc').limit(recent_user_count).get().then((snapshot) => {
                snapshot.forEach((doc) => {
                    if (doc.exists) {

                        let the_info = doc.data();

                        let purl = the_info.photoURL;
                        let pdn = the_info.displayName;
                        let pun = doc.id;

                        if (purl.substring(0, 4).toLowerCase() === "http")
                            $("#recent_users_div").append("<img title=\"" + pdn + "\" src=\"" + purl + "\" onclick=\"get_user('" + pun + "')\"/>");
                        else {
                            storage.ref().child("Custom_Photos/" + purl).getDownloadURL().then((url) => {

                                $("#recent_users_div").append("<img title=\"" + pdn + "\" src=\"" + url + "\" onclick=\"get_user('" + pun + "')\"/>");

                            });
                        }
                    }
                });
            });



            // Listen For Server Updates, Spefically for Score and Write Queue

            stop_messages = db.collection("Messages").doc(global_user.uid).onSnapshot((doc) => {


                if (!doc.exists)
                    return;

                let message_data = doc.data().messages;

                $("#messages_div").html('<tr id="warning"><td><b>' + warning_message.title + '</b> ' + warning_message.message + '</td></tr>');


                for (let i = message_data.length - 1; i >= 0 && i >= (message_data.length - number_of_messages); i--) {

                    $("#messages_div").append('<tr><td><b>' + (message_data[i].title || "") + '</b> ' + (message_data[i].message || "") + '</td></tr>');
                    user_has_messages = true;

                    if (i >= (last_message_data_length || message_data.length))
                        $.notify(message_data[i].title);
                }


                var last_message_data_length = message_data.length;

            });


            $("#announcements_div").html("");

            $(".logged_in loader-icon").show();

            function process_messages_data() {
                let announcement_data = messages_data.announcements;
                let stats_data = messages_data.stats;



                // recent_stories_table_snapshot = JSON.parse(doc.data().recent_stories);

                for (let i = announcement_data.length - 1; i >= 0; i--) {

                    $("#announcements_div").append('<p><b>' + announcement_data[i].title + '</b> ' + announcement_data[i].message);
                }

                // FUn stats


                $(".logged_in loader-icon").hide();
                $("#cool_stats").html("<tr style=\"display: none\"><td></td></tr><tr><td><b>Number Of Bashers:</b> " + numberWithCommas(stats_data.total_users) + "</td></tr>");
                $("#cool_stats").append("<tr><td><b>Stories Completed:</b> " + numberWithCommas(stats_data.completed_stories) + "</td></tr>");
                $("#cool_stats").append("<tr><td><b>Stories In Progress:</b> " + numberWithCommas(stats_data.total_stories - stats_data.completed_stories) + "</td></tr>");



                db.collection("Users").doc(stats_data.most_points.user).get().then((un) => {

                    if (un.exists) {

                        let cont = un.data();
                        let purl = cont.photoURL;

                        if (cont.photoURL.substring(0, 4).toLowerCase() !== "http") {
                            storage.ref().child("Custom_Photos/" + cont.photoURL).getDownloadURL().then((url) => {
                                purl = url;
                                $("#cool_stats").append("<tr><td id=\"highest\" onclick=\"get_user('" + stats_data.most_points.user + "')\"><img title=\"" + cont.displayName + "\" src=\"" + purl + "\" /><b>Highest Ranked Basher:</b><br />" + cont.displayName + " (" + numberWithCommas(cont.score) + ")" + "</td></tr>");

                            });
                        } else
                            $("#cool_stats").append("<tr><td id=\"highest\" onclick=\"get_user('" + stats_data.most_points.user + "')\"><img title=\"" + cont.displayName + "\" src=\"" + purl + "\" /><b>Highest Ranked Basher:</b><br />" + cont.displayName + " (" + numberWithCommas(cont.score) + ")" + "</td></tr>");

                    }


                }).catch(log_error);

            }

            if (!messages_data) {
                db.collection("Messages").doc("global").get().then((doc) => {


                    if (!doc.exists)
                        return;

                    messages_data = doc.data();

                    // all_user_names = messages_data.displayNames;

                    process_snapshot(JSON.parse(doc.data().top_stories), "top");
                    process_snapshot(JSON.parse(doc.data().recent_stories), "recent");
                    process_messages_data();

                })
            } else process_messages_data();



            stop_queue = db.collection("Private").doc(global_user.uid).onSnapshot((doc) => {



                if (!doc.exists)
                    return;

                let private_data = doc.data();

                if (typeof global_user.demerits === "undefined")
                    global_user.demerits = private_data.demerits;

                if (new Date().getTime() - (doc.data().queue_time || 0) > 60 * 3 * 1000) {
                    db.collection("Users").doc(global_user.uid).set({
                        "logged_in": true
                    }, { merge: true });
                    // console.log("requesting fresh stories asap");
                }

                queued_stories = private_data.queued_stories;

                if (on_dead_queue)
                    get_queue(true);

                // New demerit added
                if (private_data.demerits > global_user.demerits) {

                    // over threshold for first time
                    if (!warning_shown && (global_user.score / private_data.demerits < max_demerit_percentage)) {

                        warning_shown = true;
                        $("#warning").show();
                        $.notify("Please ensure you are making quality submissions!", "warn");
                        $.notify("Several of your submissions have been rejected by other users.", "warn");
                    } else {
                        // new demerit but not new threshold
                        $.notify("One of your submissions was rejected by other users.", "error");
                    }
                }

                global_user.demerits = private_data.demerits;

                // console.log("queue updated", private_data);

            });

            stop_score = db.collection("Users").doc(global_user.uid).onSnapshot((doc) => {

                if (!doc.exists)
                    return;

                let score_data = doc.data();

                if (score_data.score > global_user.score) {
                    $.notify("Your score went up " + (score_data.score - global_user.score) + (((score_data.score - global_user.score) === 1) ? " point!" : " points!"));
                    $(".score").html(numberWithCommas(score_data.score));

                    // If score went up enough to fix warning
                    if (score_data.score / global_user.demerits < max_demerit_percentage)
                        $("#warning").hide();

                }
                Object.assign(global_user, score_data);


                // console.log("score updated");

            });


            // End of ALl Users workflow load
            get_more_titles();
            get_more_rates();
            hash();

        });



    } else {

        // No user is signed in.

        // Is this doing anything?

        // Testing: 
        ui.start('#firebaseui-auth-container', uiConfig);


        hash();



    }



}); // End of Auth Change


// Utility Functions 

function blank() {



    user_stories = {};
    global_user = {};
    queued_stories = [];
    global_user.recent_words = [];
    queue_loaded = top_stories_loaded = recent_stories_loaded = warning_shown = false;
    my_photo_url = "https://basher.app/images/user.png";

    counter = {
        queue: 0, // where ou are in the queue
        story: 0, // within your personal story queue
        start: 0, // how many start_stories you've done
        rate: 0, // how many ratings youve done (gets x at a time)
        title: 0 // how many titles youve done (gets x at a time)
    };

}

//toBlob polyfill
if (!HTMLCanvasElement.prototype.toBlob) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value: function(callback, type, quality) {
            let dataURL = this.toDataURL(type, quality).split(',')[1];
            setTimeout(function() {
                let binStr = atob(dataURL),
                    len = binStr.length,
                    arr = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    arr[i] = binStr.charCodeAt(i);
                }
                callback(new Blob([arr], { type: type || 'image/png' }));
            });
        }
    });
}


function compress(e) {
    const reader = new FileReader();
    reader.readAsDataURL(e);
    // console.log("3");
    reader.onload = event => {
        // console.log("2");
        let img = new Image();
        img.src = event.target.result;
        img.onerror = (error) => {
            // console.log(error);
        }
        img.onload = () => {

                const elem = document.createElement('canvas');
                const ctx = elem.getContext('2d');
                const height = 200; // fixed height in pixels
                const scaleFactor = height / img.height;
                elem.height = height;
                elem.width = img.width * scaleFactor;
                ctx.drawImage(img, 0, 0, img.width * scaleFactor, height);
                console.log((ctx || false), (ctx.canvas || false));
                ctx.canvas.toBlob((blob) => {

                    upload_new_image(new File([blob], "new_pic", {
                        type: 'image/jpeg'
                    }));
                }, 'image/jpeg', 1);
            },
            reader.onerror = error => console.log(error);
    };
}

function hash() {

    let show_hash = getQueryVariable("show");
    let id_hash = getQueryVariable("id");

    if (global_user.uid || false) {
        $(".not_logged_in").hide();
        $(".logged_in").show();
    } else {
        $(".logged_in").hide();
        $(".not_logged_in").show();
    }

    if (show_hash == "top")
        get_top_stories();
    else if (show_hash == "recent")
        get_recent_stories();
    else if (show_hash == "write" && (queued_stories[counter.story] || false))
        get_queue();
    else if (show_hash == "profile" && ((global_user.uid || false) || id_hash))
        get_user(id_hash);
    else if (show_hash == "story" && id_hash)
        get_story(id_hash);
    else if (show_hash == "about")
        get_about();
    else
        get_start();


}


window.onpopstate = function(event) {
    hash();
}

function log_error(error) {
    console.error(error);
    return (true);
}

function getQueryVariable(variable) {
    let query = window.location.search.substring(1);
    let vars = query.split("&");
    for (let i = 0; i < vars.length; i++) {
        let pair = vars[i].split("=");
        if (pair[0] == variable) {
            return pair[1];
        }
    }
    return false;
}


function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function sanitize(word) {

    return word.replace(/[^-'0-9a-zÀ-ÿ]|[Þß÷þø]/ig, "").toLowerCase().trim();

}

function check_input() {

    let the_input = sanitize($("#f1").val());

    // Sanitize input on the fly
    $("#f1").val(the_input);

    if (the_input == "") {
        $(".queue new-word .approve").hide();
        if ((story_db.story || false) && story_db.story.length > minimum_story_length) {
            $(".queue h2").html("Write The Next Word, Or Mark The Story Finished");
            $(".flag").show();
        }
    } else {
        if (story_db.id || false)
            $(".queue h2").html("Write The Next Word");

        $(".queue new-word .approve").show();
        $(".flag").hide();
    }
}

function logout() {
    stop_queue();
    stop_score();
    stop_story();
    stop_messages();
    $("#register").show();
    firebase.auth().signOut();
}

function validateEmail(email) {
    let re = /\S+@\S+\.\S+/;
    return re.test(email);
}


function star(raw_number, user_score) {

    // Shouldnt need these but just in case? 

    if (raw_number > 5)
        raw_number = 5;

    if (user_score > 5)
        user_score = 5;

    if (raw_number < 0)
        raw_number = 0;

    if (user_score < 0)
        user_score = 0;

    // Either black or gold star, wholes only, then maybe half

    let stars = Math.floor(raw_number);
    if (user_score)
        stars = Math.floor(user_score);



    let return_string = '';
    let half_star = (raw_number - stars >= .25 && raw_number - stars < .75) ? 1 : 0;

    if (raw_number - stars >= .75)
        stars++;

    // Draw Black or Gold Stars 



    for (let i = 0; i < stars; i++) {
        return_string += '<svg class="star ' + ((user_score) ? "gold" : "") + ' star_' + (i + 1) + '" data-value="' + (i + 1) + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';

    }

    // Draw Half Star 

    if (half_star && !user_score) {
        stars++;
        return_string += '<svg class="star half star_' + stars + '" data-value="' + stars + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';
        return_string += '<svg class="star halfoff off star_' + stars + '" data-value="' + stars + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';

    }

    // Draw Empty Gray Stars
    for (let i = stars; i < 5; i++) {
        return_string += '<svg class="star star_' + (i + 1) + ' off" data-value="' + (i + 1) + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';

    }
    // Returns a bunch of SVGS
    return return_string

}


// USER FUNCTIONS

function resend_email() {

    $(".resend").hide();

    firebase.auth().currentUser.sendEmailVerification(email_config);

}

function change_name() {

    let new_name = $("#new_name").val();


    if (new_name.length > 15 || new_name.length <= 1) {
        $.notify("There was an error. Please choose a different name.", "error");
        return;
    }



    return $.get({
        url: "//us-central1-milli0ns0fm0nkeys.cloudfunctions.net/addTitle",
        data: {
            word: name
        },
        type: 'GET',
        dataType: 'json'
    }).done(() => {

        document.getElementById("reset_me_name").reset();


        db.collection("Users").doc(global_user.uid).update({
                "displayName": new_name
            }).then(() => {

                $(".user_id").html(new_name);
                global_user.displayName = new_name;
                $.notify("Display name updated.");
                $("change-name").hide();

            })
            .catch((error) => {
                $.notify("There was an error. Please choose a different name.", "error");
                console.error(error);
            });

        return;

    }).fail(() => {

        $.notify("There was an error. Please choose a different name.", "error");
        return;

    });

}

function change_email() {

    let new_email = $("#new_email").val();
    let their_password = $("#new_email_password").val();


    if (!validateEmail(new_email) || their_password.length < 6) {
        $.notify("There was an error. Please check your email address.", "error");
        return;
    }


    document.getElementById("reset_me_email").reset();



    let credential = firebase.auth.EmailAuthProvider.credential(global_user.email, their_password);

    firebase.auth().currentUser.reauthenticateWithCredential(credential).then(() => {
        // User re-authenticated.

        db.collection("Users").doc(global_user.uid).update({
                "email": new_email
            }).then(() => {

                // $(".email").html(new_email);
                //  global_user.email = new_email;
                $.notify("Email address updated.");
                $("change-email").hide();
                $(".email").html(new_email);
                firebase.auth().currentUser.sendEmailVerification(email_config);




            })
            .catch((error) => {
                $.notify("There was an error. Please check your email address.", "error");
                console.error(error);
            });

    }).catch(log_error);

}


function change_password() {

    let old_password = $("#old_password").val();
    let new_password = $("#new_password").val();
    let confirm_password = $("#confirm_password").val();

    if (new_password !== confirm_password || new_password.length < 6 || new_password == old_password) {
        $.notify("There was an error. Please choose a different password.", "error");
        return;
    }

    document.getElementById("reset_me_password").reset();


    let credential = firebase.auth.EmailAuthProvider.credential(global_user.email, old_password);

    global_user.reauthenticateWithCredential(credential).then(() => {
        // User re-authenticated.

        global_user.updatePassword(new_password).then(() => {


            $.notify("Password changed.");
            $("change-password").hide();

        }).catch((error) => {

            // console.log(error)
            $.notify("There was an error. Please choose a different password.", "error");
        });

    }).catch(log_error);

}


function imageFound() {
    imageNotFound(true);
}

function imageNotFound(found) {

    // This function runs after the image is stored, when it renders. If it fails to load, we go back to default image.

    let write_this = "https://basher.app/images/user.png";
    global_user.photoURL = write_this;

    if (found) {
        global_user.photoURL = new_profile_pic.src;
        write_this = global_user.uid
    }

    $("loader-icon").hide();
    $("user-photo").html('<img src="' + global_user.photoURL + '">');
    $.notify("Profile photo updated.");
    my_photo_url = global_user.photoURL;

    db.collection("Users").doc(global_user.uid).update({
        "photoURL": write_this
    }).catch(log_error);
}


document.getElementById("change_photo").onchange = function() {
    compress($("#change_photo")[0].files[0] || null);
};

function upload_new_image(the_file) {


    if (!the_file)
        return;

    if (the_file.size > 1024 * 1024 * 1.2) {
        $.notify("There was an error. Please try a different image.", "error");
        return;
    }


    //      document.getElementById("reset_me_upload").reset();
    $("loader-icon").css("display", "inline");

    let uploadTask = storage.ref().child("Custom_Photos/" + global_user.uid).put(the_file);

    uploadTask.on('state_changed', (snapshot) => {

        let progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

        console.log('Upload is ' + progress + '% done and running is ' + firebase.storage.TaskState.RUNNING);


    }, (error) => {
        // Handle unsuccessful uploads
        // console.log(error);

        $("loader-icon").hide();
        $.notify("There was an error. Please choose a different image.", "error");


    }, () => {

        // Handle successful uploads

        uploadTask.snapshot.ref.getDownloadURL().then((url) => {

            new_profile_pic.onload = imageFound;
            new_profile_pic.onerror = imageNotFound;
            new_profile_pic.src = url;

        }).catch(log_error);

    });

}

// LOADING STRUCTURE

function div_loading(finished, load_this, instant) {

    if (load_this !== "error")
        on_dead_queue = false;
    else
        queue_loaded = false;


    // Call this function to let app know when loading is starting or finished. Allows for "loading" screen, and maybe transitions.

    // No loading needed so just show stuff
    if (instant) {
        load_when_finshed = load_this;
        finished = true;

    }

    // Ready To Display
    if (finished && load_when_finshed == load_this) {

        loading = false;

        // Queue, Read Story, Top Stories, Recent Stories, User
        $("main section").hide();
        $("main ." + load_this).show();
        $("main").show();

        // console.log("Page: ", load_this);

        //           $("main h2:visible,the-story:visible")[0].scrollIntoView();

    }

    // First Load Request
    else if (!finished && !loading) {

        loading = true;

        $("main").hide();
        $("main section").hide();

        load_when_finshed = load_this;

        //  console.log("Loading: ", load_this);

    }

    // Another Load Request Before Previous One Is Finished
    else if (!finished && loading) {

        load_when_finshed = load_this;

        //  console.log("New load request: ", load_this);
    }



    if (finished && ((load_this === "queue" || load_this === "top_stories_page" || load_this === "story" || load_this === "recent_stories_page" || load_this === "queue")) && load_ad[load_this].page1) {


        // $(".adsbygoogle").hide();
        //        $("main ." + load_this + " .adslot_1").show();

        load_ad[load_this].page1 = false;

        /*
        $('ins').each(function() {
             all_ins++;
            console.log(all_ins);
            (adsbygoogle = window.adsbygoogle || []).push({});
        });
        */


    }

}


// QUEUE FUNCTIONS 

function get_start() {

    update_history();
    div_loading(false, "start", true);


}


function update_history(url, title, update) {

    let little_hash = url;

    full_title = (title ? "Basher! " + title : default_title);

    if (location.hostname !== "localhost") {

        url = (url ? "?show=" + url : "");

        if (gtag || false)
            gtag('config', 'UA-139149604-1', {
                'page_title': title,
                'page_location': "https://basher.app/" + url,
                'page_path': '/' + url
            });

        history.pushState(null, full_title, "https://basher.app/" + url);
    }

    document.title = full_title;

    if (!schema_generated) {

        schema_generated = true;

        var schema_data = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": default_title,
            "url": "https://basher.app/" + url

        };

        if (update) {
            // A Story we're reading

            if (typeof addthis !== "undefined") {

                //+ "&title=" + uri
                addthis.update('share', 'url', "https://basher.app/" + url);
                addthis.update('share', 'title', 'Basher! Story: "' + full_title + '"');
                addthis.update('share', 'description', "Read this story written one word at a time by people of the Internet.");
                addthis.update('share', 'media', "https://basher.app/images/logo.png");
            }


            schema_data["@type"] = "Article";
            schema_data.headline = title;
            schema_data.datePublished = new Date(update).toISOString();
            schema_data.dateModified = new Date(update).toISOString();
            schema_data.author = {
                "@type": "Organization",
                "name": "Basher"
            };
            schema_data.publisher = {
                "@type": "Organization",
                "name": "Basher",
                "logo": {
                    "@type": "ImageObject",
                    "url": "https://basher.app/images/logo.png",
                    "width": 750,
                    "height": 500
                }
            };
            schema_data.mainEntityOfPage = {
                "@type": "WebPage",
                "@id": "https://basher.app/?show=top"
            };

            schema_data.image = {
                "@type": "ImageObject",
                "url": "https://basher.app/images/logo.png",
                "width": 750,
                "height": 500
            };



        } else if (little_hash == "top" || little_hash == "recent" || little_hash == "about") {

            schema_data["@type"] = "BreadcrumbList";
            schema_data.itemListElement = [{
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": "https://basher.app"
            }, {
                "@type": "ListItem",
                "position": 2,
                "name": title,
                "item": "https://basher.app/" + url
            }];
        } else {
            schema_data["@type"] = "WebSite";
            schema_data.datePublished = new Date().toISOString();
        }

        var script = document.createElement('script');
        script.type = "application/ld+json";
        script.innerHTML = JSON.stringify(schema_data);
        // console.log(JSON.stringify(schema_data));
        document.getElementsByTagName('body')[0].appendChild(script);
    }
}

function get_about() {

    update_history("about", "About Us");

    div_loading(false, "about", true);


}

function get_queue(ready_for_new_queue) {

    update_history("write", "Write");



    // If the queue has already been loaded once, just show it. Doesn't need to be reloaded.

    if (queue_loaded && !ready_for_new_queue) {
        div_loading(true, "queue", true);
        return;
    }

    // Turn off snapshot on previous story. on 1st run its a blank function
    stop_story();

    // From Now on, just show it unless ready_for_new_queue is true.
    queue_loaded = true;

    div_loading(false, "queue");

    // Check init for size of queue, but here's where it plays out:

    let to_load = "";

    if (counter.queue % queue_rounds < queue_rate) {
        to_load = "write";
    } else if (counter.queue % queue_rounds < queue_title) {
        to_load = "rate";
    } else if (counter.queue % queue_rounds < queue_start) {
        to_load = "title";
    } else // if (counter.queue % queue_rounds < queue_rounds)
    {
        to_load = "start";
    }

    // Iterates through
    counter.queue++;

    // Here we download the queues, make sure there's a good match, before generating the pages.

    switch (to_load) {

        case "write":

            // Server queues writes, just go to the next one on the list.

            if (queued_stories[counter.story] || false) {

                load_queue(queued_stories[counter.story], "write");

                counter.story++;
                // console.log("story counter: ", counter.story);

            } else {
                // originally theis was  counter.queue = queue_rate and then no break, but no other section did that... why do it with write?
                // console.log("write failed, trying next");
                counter.queue = queue_rate;
                get_queue(true);
            }

            break;

        case "rate":



            if (counter.rate + 1 >= queued_rates.length) {
                get_more_rates();
            }

            if (queued_rates[counter.rate] || false) {

                load_queue(queued_rates[counter.rate], "rate");
                counter.rate++;
            } else {
                // console.log("rate finisihed. trying whats after.");
                get_more_rates();
                counter.queue = queue_title;
                get_queue(true);
            }

            break;

        case "title":



            if (counter.title + 1 >= queued_titles.length) {
                get_more_titles();
            }

            if (queued_titles[counter.title] || false) {

                load_queue(queued_titles[counter.title], "title");
                counter.title++;
            } else {
                // console.log("title finisihed. trying whats after.");
                get_more_titles();
                counter.queue = queue_start;
                get_queue(true);
            }
            break;

        case "start":

            counter.start++;

            // This shouldbe same condition as in RULES
            if (global_user.stories_created === 0 || (global_user.score / global_user.stories_created > score_to_stories_ratio)) {

                load_queue(null, "start");

            } else {

                // console.log("not ready to start yet.");

                if (queued_stories[counter.story] || false) {
                    // console.log("ready to write, tho");
                    counter.queue = queue_write;
                    get_queue(true);
                } else if (queued_rates[counter.rate] || false) {
                    // console.log("ready to rate, tho");
                    counter.queue = queue_rate;
                    get_queue(true);

                } else if (queued_titles[counter.title] || false) {
                    // console.log("ready to title, tho");
                    counter.queue = queue_title;
                    get_queue(true);
                } else {
                    div_loading(true, "error", true);
                    queue_loaded = false;
                    on_dead_queue = true;
                }

            }
            break;

        default:
            div_loading(true, "error", true);
            on_dead_queue = true;
            queue_loaded = false;


    }
}

function get_more_titles() {

    // console.log('grabbing titles');

    queued_titles = [];
    counter.title = 0;

    db.collection("Stories").where('title', "==", 0).where('date_finished', ">", 0).orderBy('date_finished', 'asc').limit(rates_and_titles_limit).get().then((snapshot) => {

            if (!snapshot.empty) {

                snapshot.forEach((doc) => {

                    if (doc.exists) {

                        // THIS IS WHAT DOESN'T ALLOW DOUBLES

                        if (user_stories[doc.id] || false)
                            return;

                        queued_titles.push(doc.id);

                    }

                });

            }
        })
        .catch(log_error);

}


function get_more_rates() {

    // console.log('grabbing rates');
    queued_rates = [];
    counter.rate = 0;

    db.collection("Stories").where('pending_title', "==", null).orderBy('rating.votes', 'asc').limit(rates_and_titles_limit).get().then((snapshot) => {

            if (!snapshot.empty) {

                snapshot.forEach((doc) => {

                    if (doc.exists) {

                        // THIS IS WHAT DOESN'T ALLOW DOUBLES

                        if (user_stories[doc.id] || false)
                            return;

                        queued_rates.push(doc.id);

                    }

                });



            }
        })
        .catch(log_error);
}


function load_queue(story_id, lets_do_this) {

    // Once we know what type of queue we're loading, do this. Reset everything, then show what we need.

    $(".queue button").attr("disabled", false);
    $("#queue_rating").removeClass();
    $(".queue input, select").val("");
    $(".queue contributors-wrapper ul, .queue the-title, .queue the-story, .queue suggest-title ul, .queue pending-word").html("");
    $(".queue contributors-wrapper, select, .queue new-word, .queue approval-wrapper, .queue rating-wrapper, .queue suggest-title, .queue the-title, .queue approval-wrapper, .queue new-word .approve, .queue .flag, .queue .error-code, button.deny, .queue loader-icon").hide();


    if (lets_do_this == "start") {


        document.getElementById("f1").focus();
        $('new-word').css("display", "inline");

        $('.queue contributors-wrapper').show();

        $(".queue h2").html("Write The First Word Of The Next&nbsp;Great&nbsp;Story");
        $(".queue contributors-wrapper ul").html('<li onclick="get_user(\'' + global_user.uid + '\')">' + global_user.displayName + '</li>');

        story_db = {};

        div_loading(true, "queue");
        return;

        // No story fetch needed for start.
    }

    db.collection("Stories").doc(story_id).get().then((doc) => {

        if (doc.exists) {

            story_db = doc.data();
            story_db.id = story_id;

            let story_string = "";

            story_db.story.forEach((value) => {
                story_string = story_string + value;

            });


            // Load Rating

            let user_rating = null;

            if (user_stories || false) {

                if (user_stories[story_id] || false)

                    user_rating = (user_stories[story_id].rating || null);

            }


            // Load Story Basics 

            if (story_db.title)
                $(".queue the-title").html(story_db.title);

            $(".queue the-story").html(story_string);
            $(".queue rating-wrapper .votes_cast").html("(" + story_db.rating.score.toFixed(2) + " rating - " + story_db.rating.votes + ((story_db.rating.votes !== 1) ? " votes)" : " vote)"));
            $("#queue_rating").addClass(story_id);
            $("#queue_rating").html(star(story_db.rating.score, user_rating));
            $("button.deny").show();


            // Load contributors - PAUSING THIS FOR QUEUE
            /*
                        story_db.contributors.forEach((one) => {


                            db.collection("Users").doc(one).get().then((un) => {

                                if (un.exists) {

                                    let cont = un.data();

                                    $(".queue contributors-wrapper ul").append('<li onclick="get_user(\'' + one + '\')">' + cont.displayName + '</li>');
                                } //else
                                // console.error("Get user name failed.", one);
                            });

                        });
            */

            // Load For Queue 

            if (lets_do_this == "title") {

                if (!story_db.pending_title)
                    return get_queue(true);


                story_db.pending_title.forEach((one, index) => {
                    $(".queue suggest-title ul").prepend("<li> <input type=\"radio\" name=\"title_radio\" value=\"" + (index + 2) + "\" />" + one.title + "</li>");
                });

                $(".queue h2").html("Suggest/Vote On The Title");
                $(".queue suggest-title ul").append('<li><input type="radio" name=\"title_radio\" value="1"' + ((story_db.pending_title.length === 0) ? " checked" : "") + ' /><input type="text" maxlength="45" id="submit_title" /></li>');


                $(".queue suggest-title").show();

                $("#queue_rating").addClass("star_wrap");

                $(".queue .star_wrap .star").click(function(data) {

                    // You can rate without voting in title mode
                    vote(parseInt($(this).attr("data-value")), story_db);

                });

                $(".queue rating-wrapper").show();

            } else if (lets_do_this == "rate") {

                $(".queue h2").html("Rate This Story");

                $(".queue the-title").show();

                $("#queue_rating").addClass("star_wrap");

                $(".queue .star_wrap .star").click(function(data) {

                    vote(parseInt($(this).attr("data-value")), story_db);

                    get_queue(true);

                });

                $(".queue rating-wrapper").show();

            } else if (lets_do_this == "write") {


                stop_story = db.collection("Stories").doc(story_id).onSnapshot((doc) => {

                    if (!doc.exists)
                        return;

                    let the_data = doc.data();

                    if (the_data.story.length !== story_db.story.length || the_data.date_finished !== story_db.date_finished) {

                        // console.log("story refresh");
                        counter.queue--;
                        get_queue(true);

                    }
                    // else
                    // console.log("story updated, no reresh");

                });




                $(".queue approval-wrapper").css("display", "inline");

                if (story_db.pending_word.word.trim() == "[END]") {
                    $("select.end").show();
                    $(".queue pending-word").hide();
                    $(".queue h2").html("Is this story finished?");



                } else {

                    $(".queue h2").html("Approve Or Reject The The Last Word");

                    let pendingword = story_db.pending_word.word;
                    if (punc.indexOf(pendingword.substring(0, 1)) === -1)
                        pendingword = (story_db.pending_word.punctuation || "") + "&nbsp;" + pendingword.trim();
                    $(".queue pending-word").html(pendingword);
                    $(".queue pending-word").show();

                }
            }

            // shit's loaded now, it was all jquery no promise shere, accept contributors which can wait
            div_loading(true, "queue");


        } else {

            // console.log("Error, story doc was not found.");
            $("section .queue").hide();
            queue_loaded = false;
            $("main .error").show();
            $("main").show();
            get_queue(true);

        }

        // ENd of get story promise
    });

    // End of load story function
}

// USER ACTION FUNCTIONS

function approve() {

    $(".queue button").attr("disabled", true);

    if (story_db.pending_word.upvotes == 0) {

        db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

                "yes_vote": true

            }).then(() => {
                // console.log("Yes vote accepted.");
                $.notify("Your vote has been counted!");
                return;

            })
            .catch(log_error);


        return get_queue(true);

    }



    if (story_db.pending_word.word.trim() == "[END]") {

        // Last person said we should end the story.

        $("main h2:visible")[0].scrollIntoView();
        //window.scrollTo(0, Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().top) + Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().bottom));

        $(".queue h2").html("Great! Suggest A Title And Rate");

        $(".queue suggest-title ul").html('<li><input type="radio" name=\"title_radio\" value="1" checked /><input type="text" id="submit_title"  maxlength="45" /></li>');

        $(".queue suggest-title").show();

        $("#queue_rating").addClass("star_wrap");
        $(".queue approval-wrapper").hide();
        $(".queue rating-wrapper").show();

        $(".queue .star_wrap .star").click(function(data) {

            vote(parseInt($(this).attr("data-value")), story_db);


        });

        if (gtag || false) {
            gtag('event', "[END VOTE]", {
                'event_category': 'Word Submit'
            });
        }

        db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

                "yes_vote": true

            }).then(() => {
                // console.log("Yes vote accepted.");
                $.notify("You finished a story!");
                return;
            })
            .catch(log_error);

        $(".queue button").attr("disabled", false);
        stop_story();
        return;

    }

    // If it's time to write (not finished, adequate votes) pending word is approved

    // Append new word and contributor 

    $(".queue the-story").append((story_db.pending_word.punctuation || "") + " " + story_db.pending_word.word);

    //   let c_name = get_display_names(story_db.pending_word.contributor);

    //  $(".queue contributors-wrapper ul").append('<li onclick="get_user(\'' + story_db.pending_word.contributor + '\')">' + c_name + '</li>');

    /*
    db.collection("Users").doc(story_db.pending_word.contributor).get().then((un) => {

        if (un.exists) {

            let cont = un.data();

            $(".queue contributors-wrapper ul").append('<li onclick="get_user(\'' + story_db.pending_word.contributor + '\')">' + cont.displayName + '</li>');

        } // else
        // console.error("Get newest contributor user name failed.");
    });
    */


    // Money!
    write_next();

}


function write_next() {

    $(".queue button").attr("disabled", false);

    $("main h2:visible")[0].scrollIntoView();
    // window.scrollTo(0, Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().top) + Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().bottom));

    $(".queue h2").html("Write The Next Word");

    if (story_db.story.length > minimum_story_length) {
        $(".flag").show();
        $(".queue h2").html("Write The Next Word, Or Mark The Story Finished");
    }

    $('approval-wrapper').hide();
    // these next 2  appears conditionally
    $(".queue new-word .approve").hide();
    $("select.regular").show();

    $('new-word').css("display", "inline");
    document.getElementById("f1").focus();
}

function deny() {

    $(".queue button").attr("disabled", true);

    /* 
    
    if (story_db.pending_word.word.trim() == "[END]") {
        $(".flag").hide();

        write_next();

    } else {

        */

    div_loading(false, "queue");
    if (gtag || false) {
        gtag('event', "[NO VOTE]", {
            'event_category': 'Word Submit'
        });
    }
    db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

            "no_vote": true

        }, { merge: true }).then(() => {
            // console.log("No vote counted.");
            $.notify("Your vote has been counted!");
            return;



        })
        .catch(log_error);


    get_queue(true);

    //    } End vote shouldnt be treated specially?
}

$(document).on('keypress', function(e) {


    if (e.which == 13) {
        e.preventDefault();

        if ($("change-email:visible").length === 1)
            change_email();
        else if ($("change-name:visible").length === 1)
            change_name();
        else if ($("change-password:visible").length === 1)
            change_password();
        else if ($("new-word input:visible").length === 1)
            submit();
    }
});

function dictionary_check(passed, sanitized) {

    if (!passed) {
        if (global_user.score > 1000) {
            $(".queue .error-code").html("That word wasn't found in our dictionary. Are you sure you want to submit it?");
            are_you_sure = sanitized;
            last_entry = "";
        } else
            $(".queue .error-code").html("Sorry, that word wasn't found in our dictionary. You need a score of 1,000 to submit non-dictionary words.");
        $(".queue loader-icon").hide();
        $(".queue .error-code").show();

        if (gtag || false) {

            gtag('event', sanitized, {
                'event_category': 'Dictionary Check Failed'
            });


        }

        $(".queue button").attr("disabled", false);
        return;
    } else {

        are_you_sure = "";

        div_loading(false, "queue");

        if (story_db.id || false) {

            submit_word(sanitized);

        } else {
            // If creating a new story
            db.collection("Users").doc(global_user.uid).collection("Stories").add({

                    "new_word": sanitized

                }).then(() => {
                    // console.log("New word posted to new story.");
                    $.notify("Your story has entered the queue!");
                    return;

                })
                .catch(log_error);

            $(".queue loader-icon").hide();
            get_queue(true);


        }



    }

}

function submit(flag_end) {

    if (flag_end && !flag_end_confirmation) {
        $(".queue h2").html("Are you sure this story is finished?");
        flag_end_confirmation = true;
        return;
    }

    flag_end_confirmation = false;

    $(".queue button").attr("disabled", true);

    if (flag_end) {

        submit_word("[END]");
        div_loading(false, "queue");

        return;

    }

    let sanitized = sanitize($("new-word input").val());

    if (sanitized == "") {
        $(".queue button").attr("disabled", false);
        return;
    } else if (sanitized == last_entry) {
        $(".queue .error-code").html("You already submitted that word.");
        $(".queue .error-code").show();
        $(".queue button").attr("disabled", false);
        return;
    }

    $(".queue .error-code").hide();
    $(".queue loader-icon").show();

    last_entry = sanitized;

    if (are_you_sure == "" || are_you_sure !== sanitized) {

        $.get({
            url: "//us-central1-milli0ns0fm0nkeys.cloudfunctions.net/addWord",
            data: {
                word: sanitized
            },
            type: 'GET',
            dataType: 'json'
        }).done((data) => {

            // console.log(data);
            dictionary_check(data, sanitized);

        }).fail((error) => {

            $(".queue .error-code").html("An error occured submitting that word.");
            $(".queue .error-code").show();
            $(".queue button").attr("disabled", false);
            return;
        });

    } else {
        dictionary_check(true, sanitized);
    }



}

function submit_word(this_word) {

    if (gtag || false) {
        gtag('event', this_word, {
            'event_category': 'Word Submit'
        });
    }
    db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

            "new_word": this_word,
            "punctuation": $("select.regular").val()

        }, { merge: true }).then(() => {
            // console.log("New word accepted.");
            if (this_word === "[END]")
                $.notify("Your ending has been queued for approval!");
            else
                $.notify("Your word has been queued for approval!");

            return;

        })
        .catch(log_error);

    $(".queue loader-icon").hide();
    get_queue(true);


}

function vote(num_stars, which_db) {

    // console.log(num_stars, which_db);

    which_story = which_db.id;

    if (user_stories[which_story] || false)
        user_stories[which_story].rating = num_stars;
    else
        user_stories[which_story] = {
            "rating": num_stars
        };



    if (num_stars >= 1)
        $("." + which_story + " .star").removeClass("gold");

    $("." + which_story + " .star").addClass("off");

    if (num_stars >= 1)
        $("." + which_story + " .star_1").addClass("gold");
    if (num_stars >= 2)
        $("." + which_story + " .star_2").addClass("gold");
    if (num_stars >= 3)
        $("." + which_story + " .star_3").addClass("gold");
    if (num_stars >= 4)
        $("." + which_story + " .star_4").addClass("gold");
    if (num_stars == 5)
        $("." + which_story + " .star_5").addClass("gold");


    let new_votes = which_db.rating.votes + 1;
    let new_score = (which_db.rating.votes * which_db.rating.score + num_stars) / new_votes;

    // console.log(new_votes, new_score);

    $(".votes_cast").html("(" + new_score.toFixed(2) + " rating - " + new_votes + ((new_votes !== 1) ? " votes)" : " vote)"));

    if (gtag || false) {
        gtag('event', JSON.stringify(num_stars), {
            'event_category': 'Rating Submit'
        });
    }

    db.collection("Users").doc(global_user.uid).collection("Stories").doc(which_db.id).set({

            "rating": num_stars

        }, { merge: true }).then(() => {
            // console.log("Ratigng submitted!");
            $.notify("Rating accepted!");

            return;
        })
        .catch(log_error);


}

function submit_approved_title(vote, title_to_submit) {

    if (gtag || false) {
        gtag('event', vote + " " + (title_to_submit || ""), {
            'event_category': 'Title'
        });
    }

    db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

        "title_vote": vote,
        "submit_title": (title_to_submit || "")

    }, { merge: true }).then(() => {
        $.notify("Title vote submitted!");
        return;
    }).catch(log_error);





    get_queue(true);

};

function vote_on_title() {

    $(".queue button").attr("disabled", true);

    let vote = parseInt($('input[name=title_radio]:checked').val() || 0);

    let submit_title = "";

    // if none is checked val will be 0
    if (!vote) {
        $(".queue button").attr("disabled", false);
        return;
    }

    // if submitting a new title
    if (vote === 1) {

        submit_title = $('#submit_title').val().trim();

        // if they checked it but wrote nothing(orjust spaces)
        if (submit_title == "") {
            $(".queue button").attr("disabled", false);
            return;

        }

        $.get({
            url: "//us-central1-milli0ns0fm0nkeys.cloudfunctions.net/addTitle",
            data: {
                word: submit_title
            },
            type: 'GET',
            dataType: 'json'
        }).done((data) => {

            // console.log(data);
            submit_approved_title(vote, submit_title);

        }).fail((error) => {
            // console.log(error);
            $(".queue .error-code").html("An error occured submitting that title.");
            $(".queue .error-code").show();
            $(".queue button").attr("disabled", false);
            return;
        });
    } else
        submit_approved_title(vote);
}


function short_title(story_string, page_title) {

    if (page_title)
        return page_title;

    story_string = story_string.trim();

    if (story_string.length > max_title_length)
        story_string = story_string.substring(0, story_string.lastIndexOf(" ", max_title_length - 3));

    if (punc.indexOf(story_string.substring(story_string.length - 1)) > -1)
        story_string = story_string.substring(0, story_string.length - 1);

    story_string += "...";

    return story_string;

}

// PAGE LOADING FUNCTIONS

function get_story(story_id) {

    div_loading(false, "story");

    $(".story the-title").hide();

    /*
        var my_awesome_script = document.createElement('script');
        my_awesome_script.setAttribute('src', '//native.propellerclick.com/1?z=2720786&eid=');
        my_awesome_script.setAttribute('data-cfasync', 'false');
        my_awesome_script.setAttribute('async', 'async');

        document.getElementsByClassName("ad-wrapper")[0].innerHTML(my_awesome_script);
    */


    db.collection("Stories").doc(story_id).get().then((doc) => {

        if (doc.exists) {

            read_db = doc.data();
            read_db.id = story_id;

            // Load contributors 

            $(".story contributors-wrapper ul").html("");


            $.get({
                url: "//us-central1-milli0ns0fm0nkeys.cloudfunctions.net/getDisplayNames",
                data: {
                    uids: JSON.stringify(read_db.contributors)
                },
                type: 'GET',
                dataType: 'json'
            }).done((data) => {

                // console.log(data);
                //  let json_data = JSON.parse(data);
                return read_db.contributors.forEach((one, index) => {

                    return $(".story contributors-wrapper ul").append('<li onclick="get_user(\'' + one + '\')">' + data[index] + '</li>');

                    /*
                        db.collection("Users").doc(one).get().then((un) => {
        
                            if (un.exists) {
        
                                let cont = un.data();
        
                                $(".story contributors-wrapper ul").append('<li onclick="get_user(\'' + one + '\')">' + cont.displayName + '</li>');
                            }
                            // else
                            // console.log("Get user name failed.");
                        });
                        */
                });

            }).fail((error) => {

                return console.log("error getting displayNames", error);
            });


            // Load Story Basics 
            let story_string = "";

            read_db.story.forEach((value) => {
                story_string = story_string + value;
            });
            $(".story the-story").html(story_string);


            // Load Title

            if (read_db.title) {

                $(".story the-title").html(read_db.title);
                $(".story the-title").show();
            }


            // + "&title=" + uri
            update_history("story&id=" + read_db.id, 'Story: "' + short_title(story_string, read_db.title) + '"', read_db.last_update);


            // Load Rating
            $(".story rating-wrapper .votes_cast").html("(" + read_db.rating.score.toFixed(2) + " rating - " + read_db.rating.votes + ((read_db.rating.votes !== 1) ? " votes)" : " vote)"));
            $("#story_rating").removeClass();

            let user_rating = null;


            if (user_stories[read_db.id] || false)
                user_rating = (user_stories[read_db.id].rating || null);

            $("#story_rating").html(star(read_db.rating.score, user_rating));

            if ((global_user.uid || false) && (read_db.date_finished > 0)) {

                $("#story_rating").addClass("star_wrap " + read_db.id);

                $(".story .star_wrap .star").click(function(data) {
                    vote(parseInt($(this).attr("data-value")), read_db);
                });

            }



            // Doen
            div_loading(true, "story");

        } else {
            // console.log("No story doc found.");
        }
    });
}


function get_user(diff_user) {


    div_loading(false, "user");

    /*
    if (!diff_user || diff_user === global_user.uid) {

        if (profile_is_loaded)
            return div_loading(true, "user");

        profile_is_loaded = true;
    }

    */

    $(".your_stories, .started_stories, .favorite_stories, user-settings, .recent_words, .messages").hide();
    $("recent-words").html("");

    if (diff_user && diff_user !== global_user.uid) {

        db.collection("Users").doc(diff_user).get().then((doc) => {

            if (doc.exists) {

                let local_user = doc.data();
                local_user.uid = doc.id;

                update_history("profile&id=" + local_user.uid, "Profile: " + local_user.displayName, local_user.last_login);

                process_user(local_user);

            }

        });

    } else {

        // add settings  if its your profile we're loading

        if (user_has_messages)
            $(".messages").show();
        else
            $(".messages").hide();

        $("user-settings").show();
        $(".email").html(global_user.email);

        update_history("profile", "Your Profile");

        process_user(global_user);

    }

}

function process_user(local_user) {

    local_user.photoURL = local_user.photoURL || "https://basher.app/images/user.png";

    $("#user_h2").html("<a href=\"https://basher.app/?show=profile&id=" + local_user.uid + "\"><span " + ((local_user == global_user) ? 'class="user_id">' : ">") + local_user.displayName + "</span> <span " + ((local_user == global_user) ? 'class="score" ' : 'class="other_score" ') + ">" + numberWithCommas(local_user.score) + "</span></a>");

    $("#change_photo").prop("disabled", true);
    $("user-photo").removeClass("self");

    if (local_user.recent_words.length > 0) {

        $("recent-words").html('<table><tr style="display:none"><td></td></tr></table>');

        for (let i = 0; i < local_user.recent_words.length && i < number_of_recent_words; i++) {

            $("recent-words table").append("<tr><td>" + local_user.recent_words[local_user.recent_words.length - 1 - i] + "</td></tr>");


        }


        $(".user .recent_words").show();

    }

    if (local_user.photoURL == global_user.photoURL) {
        $("user-photo").addClass("self");
        $("#change_photo").prop("disabled", false);
        $("user-photo").html('<img src="' + my_photo_url + '">');

    } else if (local_user.photoURL.substring(0, 5) === "https")
        $("user-photo").html('<img src="' + local_user.photoURL + '">');

    else {

        let starsRef = storage.ref().child("Custom_Photos/" + local_user.photoURL);

        starsRef.getDownloadURL().then((url) => {

            $("user-photo").html('<img src="' + url + '">');

        }).catch(log_error);

    }

    get_stories("your", local_user);

    get_stories("favorite", local_user);

    $(".started_stories h2").html("Started By " + ((local_user == global_user) ? "You" : local_user.displayName) + "</span>");
    $(".your_stories h2").html("Co-Written By " + ((local_user == global_user) ? "You" : local_user.displayName) + "</span>");
    $(".favorite_stories h2").html("Loved By " + ((local_user == global_user) ? "You" : local_user.displayName) + "</span>");


    $(".rankings span").removeClass("earned");

    if (local_user.score >= 1000)
        $(".score_1000").addClass("earned");
    else if (local_user.score >= 500)
        $(".score_500").addClass("earned");
    else if (local_user.score >= 100)
        $(".score_100").addClass("earned");
    else
        $(".score_0").addClass("earned");
}

function get_stories(which_type, local_user) {


    if (which_type == "your") {

        // console.log("loading co-written stories");

        if (local_user.uid === global_user.uid && local_tables.your) {
            process_snapshot(local_tables.your, "your");
            process_snapshot(local_tables.your, "started", global_user.uid);
            div_loading(true, "user");
            return;
        }


        db.collection("Stories").where("contributors", "array-contains", local_user.uid).orderBy('rating', 'desc').limit(limit_count).get().then((snapshot) => {

            process_snapshot(snapshot, "your");
            process_snapshot(snapshot, "started", local_user.uid);

            div_loading(true, "user");

            if (local_user.uid === global_user.uid)
                local_tables.your = snapshot;



        }).catch(log_error);
    } else if (which_type == "favorite") {

        //  console.log("loading favorited stories");

        if (local_user.uid === global_user.uid && local_tables.favorite) {
            process_snapshot(local_tables.favorite, "favorite");
            div_loading(true, "user");
            return;
        }

        db.collection("Stories").where("favorites", "array-contains", local_user.uid).orderBy('date_finished', 'desc').limit(limit_count).get().then((snapshot) => {

            process_snapshot(snapshot, "favorite");

            div_loading(true, "user");

            if (local_user.uid === global_user.uid)
                local_tables.favorite = snapshot;


        }).catch(log_error);
    } else if (which_type == "recent") {



        // process_snapshot(recent_stories_table_snapshot, which_type);
        div_loading(true, "recent_stories_page");

        /*
                db.collection("Stories").orderBy('date_finished', 'desc').limit(limit_count).get().then((snapshot) => {

                    //   console.log("loading recently finished stories");

                    
                    process_snapshot(snapshot, which_type);

                    div_loading(true, "recent_stories");


                }).catch(log_error);

                */

    } else if (which_type == "top") {


        // process_snapshot(top_stories_table_snapshot, which_type);
        div_loading(true, "top_stories_page");

        /*
        db.collection("Stories").orderBy('rating.score', 'desc').limit(limit_count).get().then((snapshot) => {

            //   console.log("loading highest rated stories");

            process_snapshot(snapshot, which_type);
            div_loading(true, "top_stories");


        }).catch(log_error);

        */

    }

}




function process_snapshot(snapshot, which_type, local_uid) {

    let stories = [];
    let item_number = 0;
    let which_page = "page1";
    let page_counter = 1;

    if (which_type !== "top" && which_type !== "recent") {



        snapshot.forEach((doc) => {
            if (doc.exists) {
                let data = doc.data();
                data.id = doc.id;
                stories.push(data);

            } else {
                // console.log("This story in the list doesn't exist.", doc);
            }
        });

    } else
        stories = snapshot;
    // $("." + which_type + "_stories table").html("<tr><th>Story</th><th>Rating</th><th class=\"date\">Completed</th></tr>");

    // Your stories also includes a "started" stories table, which is your stories but where your word is first

    global_tables[which_type] = {};
    global_tables[which_type]["page1"] = "<tr><th>Story</th><th>Rating</th><th class=\"date\">Completed</th></tr>";

    stories.forEach((the_story, index) => {

        if (item_number > 1 && item_number % stories_per_page === 0) {
            if (which_type === "recent" || which_type === "top") {
                //   global_tables[which_type][which_page] += '<tr><td class="list_ad" colspan="3"><ins class="adsbygoogle" data-ad-format="fluid" data-ad-layout-key="-g6-10-2i-6j+wq" data-ad-client="ca-pub-9969357671169601" data-ad-slot="6590966493"></ins></td></tr>';
                load_ad[which_type + "_stories_page"][which_page] = true;
            }
            page_counter++;
            which_page = "page" + page_counter;
        }



        let story_string = "";

        the_story.story.forEach((value) => {
            story_string += value;
        });

        let the_date = in_progress_string;

        if (the_story.date_finished) {
            let new_date = new Date(parseInt(the_story.date_finished));
            the_date = (new_date.getMonth() + 1) + '/' + new_date.getDate() + '/' + new_date.getFullYear();
        }

        let title = short_title(story_string, the_story.title);

        let user_rating = null;

        if (user_stories || false) {

            if (user_stories[the_story.id || false])
                user_rating = (user_stories[the_story.id].rating || null);

        }

        // if the first word was written by this user, flip it to started stories (not in both)

        if ((which_type !== "started" && which_type !== "top") || (which_type == "top" && the_story.rating.votes > tweet_vote_threshold) || (which_type == "started" && the_story.contributors[0] == local_uid)) {


            // $("." + which_type + "_stories table").append("<tr class=\"" + the_story.id + "\"><td class=\"title\" onclick=\"get_story('" + the_story.id + "')\">" + title + "</td><td class=\"rating\">" + star(the_story.rating.score, user_rating) + "</td><td class=\"date\">" + the_date + "</td></tr>");
            global_tables[which_type][which_page] += "<tr class=\"" + the_story.id + "\"><td class=\"title\" onclick=\"get_story('" + the_story.id + "')\">" + title + "</td><td class=\"rating\">" + star(the_story.rating.score, user_rating) + "</td><td class=\"date\">" + the_date + "</td></tr>";
            item_number++;

        }


    });

    if (item_number === 0)
        return;

    $('.' + which_type + '_stories table').html(global_tables[which_type]["page1"]);


    if (global_tables[which_type]["page2"] || false) {

        $('.' + which_type + '_stories table').append('<tr class="more"><td colspan=3 alt="Load More" onclick="load_more(\'' + which_type + '\',2)">...</td></tr>');

    }

    $('.' + which_type + '_stories').show();








}

function load_more(which_type, which_page) {

    // console.log(which_type, which_page, load_ad[which_type + "_stories_page"]["page" + which_page]);

    $('.' + which_type + '_stories table tr:last').remove();

    $('.' + which_type + '_stories table').append(global_tables[which_type]["page" + which_page]);

    if ((which_type === "recent" || which_type === "top") && load_ad[which_type + "_stories_page"]["page" + which_page]) {

        load_ad[which_type + "_stories_page"]["page" + which_page] = false;

        /*
        $('ins').each(function() {
            (adsbygoogle = window.adsbygoogle || []).push({});
        });

        */

    }

    if (global_tables[which_type]["page" + (which_page + 1)] || false)
        $('.' + which_type + '_stories table').append('<tr class="more"><td colspan=3 onclick="load_more(\'' + which_type + '\',' + (which_page + 1) + ')">...</td></tr>');

}


function get_top_stories() {

    update_history("top", "Top Stories");



    if (top_stories_loaded) {

        div_loading(true, "top_stories_page", true);

        return;

    }

    div_loading(false, "top_stories_page");

    top_stories_loaded = true;



    get_stories("top", global_user);

}


function get_recent_stories() {

    update_history("recent", "Just Finished");



    if (recent_stories_loaded) {

        div_loading(true, "recent_stories_page", true);

        return;

    }

    div_loading(false, "recent_stories_page");

    recent_stories_loaded = true;


    get_stories("recent", global_user);

}

/*
function get_display_names(array_of_names) {

    return $.get({
        url: "//us-central1-milli0ns0fm0nkeys.cloudfunctions.net/getDisplayNames",
        data: {
            uids: JSON.stringify(array_of_names)
        },
        type: 'GET',
        dataType: 'json'
    }).done((data) => {

        return data;

    }).fail((error) => {

        return console.log("error getting displayNames", error);
    });

}
*/