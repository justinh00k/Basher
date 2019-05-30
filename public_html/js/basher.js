   // Initialize This Thing

   firebase.initializeApp({
       "apiKey": "AIzaSyABh29lA-bxkGCtNHYgq5sxnAElx-AfSJI",
       "appId": "1:909516160776:web:6b53bd4f94f8a712",
       "databaseURL": "https://milli0ns0fm0nkeys.firebaseio.com",
       "storageBucket": "milli0ns0fm0nkeys.appspot.com",
       "authDomain": "basher.app",
       "messagingSenderId": "909516160776",
       "projectId": "milli0ns0fm0nkeys"
   });


   var perf = firebase.performance();

   var story_db = {};
   var queued_rates = [];
   var queued_titles = [];
   var queued_stories = [];

   const punc = [".", ",", "!", "?"];

   // Checks if user meant to submmit non dictionary word
   var are_you_sure = last_entry = "";

   // TUrn off snapshots. make them blank just in case they get called at wrong time
   var stop_score = function() {};
   var stop_story = function() {};
   var stop_queue = function() {};

   // Not the correct sytem but
   var stories_started = 0;
   var stories_they_can_create = 1;

   // I should add in user_loaded
   var global_user = user_stories = addthis_share = queue_loaded = top_stories_loaded = recent_stories_loaded = loading = load_when_finshed = on_dead_queue = false;

   // Tracks queue - Tracks Which story in your personal queue you're on - Tracks when you get to start
   var counter = {
       queue: 0, // where ou are in the queue
       story: 0, // within your personal story queue
       start: 0, // how many start_stories you've done
       rating: 0, // how many ratings youve done (gets x at a time)
       title: 0 // how many titles youve done (gets x at a time)
   };

   var in_progress_string = '<span class="progress">in progress</span>';

   // For detecting errors with uploading new profile images.
   var new_profile_pic = new Image();

   // Default photo url - we will load user's image once only
   var my_photo_url = "https://basher.app/images/user.png";

   // For flag to apppear
   var minimum_story_length = 39; // 49?

   // Number of recent words
   var number_of_recent_words = 5;

   // number of stories to get at a time for tables, etc.
   var limit_count = 25;

   // Queue
   var writes = 10; // 50 words - 50
   var rates = 1; // 10 ratings  - 10
   var titles = 2; // 10 title votes - 20
   var starts = 1; // 10 new stories - 1 - We need fewer starts
   var starts_multiplier = 5; // starts happen every starts / starts_multipler

   // Queue Order
   var queue_write = 0;
   var queue_rate = writes;
   var queue_title = writes + rates;
   var queue_start = writes + rates + titles;
   var queue_rounds = writes + rates + titles + starts;

   // Initialize Firebase

   var db = firebase.firestore();
   var storage = firebase.storage();
   var ui = new firebaseui.auth.AuthUI(firebase.auth());
   var uiConfig = {
       callbacks: {
           signInSuccessWithAuthResult: (authResult, redirectUrl) => {
               // User successfully signed in.
               // console.log(authResult, redirectUrl);
               // Return type determines whether we continue the redirect automatically
               // or whether we leave that to developer to handle.
               $("#register").hide();
               return false;
           },
           uiShown: () => {
               // The widget is rendered.
               // Hide the loader.
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
           firebase.auth.FacebookAuthProvider.PROVIDER_ID

       ],
       // Terms of service url.
       tosUrl: 'https://basher.app/tos.html',
       // Privacy policy url.
       privacyPolicyUrl: 'https://basher.app/privacy.html'
   };

   ui.start('#firebaseui-auth-container', uiConfig);

   // not using this callback at the moment but
   var email_config = {};

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


                   // trying to find the right way to pass a name to the server, since it doesnt get there on account creation. shouldnt this come from the clone?
                   global_user.displayName = firebase.auth().currentUser.displayName.substring(0, 15);

                   //don't used old queued stories, more will come shortly
                   queued_stories = [];

                   // Get User's Story Collection

                   db.collection("Users").doc(global_user.uid).collection("Stories").get().then((story_collection) => {

                           story_collection.forEach((doc) => {

                               user_stories[doc.id] = doc.data();

                           })

                       }).then(() => {
                           console.log("Got User's Story Info");

                           // Reload Top Stories to add personal stars, in case they looked before login 
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
                           "logged_in": true,
                           "displayName": global_user.displayName
                       }, { merge: true }).then(() => {

                           console.log("Told server we're logged in!");

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

                   var starsRef1 = storage.ref().child("Custom_Photos/" + global_user.photoURL);

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






               // Listen For Server Updates, Spefically for Score and Write Queue


               stop_queue = db.collection("Private").doc(global_user.uid).onSnapshot((doc) => {

                   if (!doc.exists)
                       return;

                   if (new Date().getTime() - (doc.data().queue_time || 0) > 60 * 3 * 1000) {
                       db.collection("Users").doc(global_user.uid).update({
                           "logged_in": true
                       });
                       console.log("requesting fresh stories asap");
                   }

                   queued_stories = doc.data().queued_stories;

                   if (on_dead_queue)
                       get_queue(true);

                   console.log("queue updated", doc.data());

               });

               stop_score = db.collection("Users").doc(global_user.uid).onSnapshot((doc) => {

                   if (!doc.exists)
                       return;

                   Object.assign(global_user, doc.data());

                   global_user.displayName = firebase.auth().currentUser.displayName.substring(0, 15);

                   $(".score").html(numberWithCommas(global_user.score));

                   console.log("score updated");

               });

               get_more_titles();
               get_more_rates();

               hash();

           });



       } else {

           // No user is signed in.

           //Force reload of all lists, removes your ratings, etc.
           blank();

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
       queue_loaded = top_stories_loaded = recent_stories_loaded = false;
       my_photo_url = "https://basher.app/images/user.png";

       counter = {
           queue: 0, // where ou are in the queue
           story: 0, // within your personal story queue
           start: 0, // how many start_stories you've done
           rating: 0, // how many ratings youve done (gets x at a time)
           title: 0 // how many titles youve done (gets x at a time)
       };

   }

   //toBlob polyfill
   if (!HTMLCanvasElement.prototype.toBlob) {
       Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
           value: function(callback, type, quality) {
               var dataURL = this.toDataURL(type, quality).split(',')[1];
               setTimeout(function() {
                   var binStr = atob(dataURL),
                       len = binStr.length,
                       arr = new Uint8Array(len);
                   for (var i = 0; i < len; i++) {
                       arr[i] = binStr.charCodeAt(i);
                   }
                   callback(new Blob([arr], { type: type || 'image/png' }));
               });
           }
       });
   }


   function compress(e) {
       const fileType = e.type;
       const reader = new FileReader();
       reader.readAsDataURL(e);
       console.log("3");
       reader.onload = event => {
           console.log("2");
           var img = new Image();
           img.src = event.target.result;
           img.onerror = (error) => {
               console.log(error);
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

       var show_hash = getQueryVariable("show");
       var id_hash = getQueryVariable("id");

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
       else
           get_start();


   }


   window.onpopstate = function(event) {
       hash();
   }

   function log_error(error) {
       console.error(error);
       return (false);
   }

   function getQueryVariable(variable) {
       var query = window.location.search.substring(1);
       var vars = query.split("&");
       for (var i = 0; i < vars.length; i++) {
           var pair = vars[i].split("=");
           if (pair[0] == variable) {
               return pair[1];
           }
       }
       return (false);
   }


   function numberWithCommas(x) {
       return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
   }

   function sanitize(word) {



       return word.replace(/[^-'0-9a-zÀ-ÿ]|[Þß÷þø]/ig, "").toLowerCase().trim();

   }

   function check_input() {

       var the_input = sanitize($("#f1").val());

       // Sanitize input on the fly
       $("#f1").val(the_input);

       if (the_input == "") {
           $(".queue new-word .approve").hide();
           if ((story_db.story || false) && story_db.story.length > minimum_story_length)
               $(".flag").show();
       } else {
           $(".queue new-word .approve").show();
           $(".flag").hide();
       }
   }

   function logout() {
       stop_queue();
       stop_score();
       stop_story();
       $("#register").show();
       firebase.auth().signOut();
   }

   function validateEmail(email) {
       var re = /\S+@\S+\.\S+/;
       return re.test(email);
   }

   function validateName(name) {

       if (name.length <= 15)
           return true;
   }

   function star(raw_number, user_score) {


       // Either black or gold star, wholes only, then maybe half

       var stars = Math.floor(raw_number);
       if (user_score)
           stars = Math.floor(user_score)

       var return_string = '';
       var half_star = (raw_number - stars >= .5) ? true : false;

       // Draw Black or Gold Stars 

       for (i = 0; i < stars; i++) {
           return_string += '<svg class="star ' + ((user_score) ? "gold" : "") + ' star_' + (i + 1) + '" data-value="' + (i + 1) + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';

       }

       // Draw Half Star 

       if (half_star && !user_score) {
           return_string += '<svg class="star star_' + (i + 1) + '" data-value="' + (i + 1) + '" width="260" height="245" viewBox="0 0 260 245" xmlns="http://www.w3.org/2000/svg"><path d="m55,237 74-228 74,228L9,96h240"/></svg>';
           stars++;
       }

       // Draw Empty Gray Stars
       for (i = stars; i < 5; i++) {
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

       var new_name = $("#new_name").val();

       if (!validateName(new_name)) {
           $("change_name .error-code").show();
           return;
       }

       document.getElementById("reset_me_name").reset();
       $("change_name .error-code").hide();

       db.collection("Users").doc(global_user.uid).update({
               "displayName": new_name
           }).then(() => {

               $(".user_id").html(new_name);
               global_user.displayName = new_name;

           })
           .catch((error) => {
               $("change_name .error-code").show();
               console.error(error);
           });



   }

   function change_email() {

       var new_email = $("#new_email").val();
       var their_password = $("#new_email_password").val();


       if (!validateEmail(new_email) || their_password.length < 6) {
           $("change_email .error-code").show();
           return;
       }

       $("change_email .error-code").hide();
       document.getElementById("reset_me_email").reset();



       var credential = firebase.auth.EmailAuthProvider.credential(global_user.email, their_password);

       firebase.auth().currentUser.reauthenticateAndRetrieveDataWithCredential(credential).then(() => {
           // User re-authenticated.

           db.collection("Users").doc(global_user.uid).update({
                   "email": new_email
               }).then(() => {

                   // $(".email").html(new_email);
                   //  global_user.email = new_email;
                   firebase.auth().currentUser.sendEmailVerification(email_config);




               })
               .catch((error) => {
                   $("change_email .error-code").show();
                   console.error(error);
               });

       }).catch(log_error);

   }


   function change_password() {

       var old_password = $("#old_password").val();
       var new_password = $("#new_password").val();
       var confirm_password = $("#confirm_password").val();

       if (new_password !== confirm_password || new_password.length < 6 || new_password == old_password) {
           $("change_password .error-code").show();
           return;
       }

       document.getElementById("reset_me_password").reset();
       $("change_password .error-code").hide();

       var credential = firebase.auth.EmailAuthProvider.credential(global_user.email, old_password);

       global_user.reauthenticateAndRetrieveDataWithCredential(credential).then(() => {
           // User re-authenticated.

           global_user.updatePassword(new_password).then(() => {

               $("change_password .error-code").hide();

           }).catch((error) => {

               console.log(error)
               $("change_password .error-code").show();
           });

       }).catch(log_error);

   }


   function imageFound(found) {
       imageNotFound(true);
   }

   function imageNotFound(found) {

       // This function runs after the image is stored, when it renders. If it fails to load, we go back to default image.

       var write_this = "https://basher.app/images/user.png";
       global_user.photoURL = write_this;

       if (found) {
           global_user.photoURL = new_profile_pic.src;
           write_this = global_user.uid
       }

       $("loader-icon").hide();
       $("user-photo").html('<img src="' + global_user.photoURL + '">');

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
           $("upload-image .error-code").css("display", "inline");
           return;
       }

       $("upload-image .error-code").hide();
       //      document.getElementById("reset_me_upload").reset();
       $("loader-icon").css("display", "inline");

       var uploadTask = storage.ref().child("Custom_Photos/" + global_user.uid).put(the_file);

       uploadTask.on('state_changed', (snapshot) => {

           var progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

           console.log('Upload is ' + progress + '% done and running is ' + firebase.storage.TaskState.RUNNING);


       }, (error) => {
           // Handle unsuccessful uploads
           console.log(error);

           $("loader-icon").hide();
           $("upload-image .error-code").css("display", "inline");


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

   }


   // QUEUE FUNCTIONS 

   function get_start() {

       div_loading(false, "start", true);


   }

   function get_about() {

       div_loading(false, "about", true);


   }

   function get_queue(ready_for_new_queue) {

       history.pushState({
           "page": "queue"
       }, "Basher! Write", "https://basher.app/?show=write");




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

       var to_load = "";

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

       // Sets to true when a good match is found
       var queue_ready = false;



       switch (to_load) {

           case "write":

               // Server queues writes, just go to the next one on the list.

               if (queued_stories[counter.story] || false) {

                   load_queue(queued_stories[counter.story], "write");

                   counter.story++;
                   console.log("story counter: ", counter.story);

               } else {
                   // originally theis was  counter.queue = queue_rate and then no break, but no other section did that... why do it with write?
                   console.log("write failed, trying next");
                   counter.queue = queue_rate;
                   get_queue(true);
               }

               break;

           case "rate":

               counter.rate++;

               if (counter.rate % 25 == 20) {
                   get_more_rates();
               }

               if (queued_rates[counter.rate] || false) {
                   queue_ready = true;
                   load_queue(queued_rates[counter.rate], "rate");
               } else {
                   console.log("rate finisihed. trying whats after.");
                   get_more_rates();
                   counter.queue = queue_title;
                   get_queue(true);
               }

               break;

           case "title":

               counter.title++;

               if (counter.title % 25 == 20) {
                   get_more_titles();
               }

               if (queued_titles[counter.title] || false) {
                   queue_ready = true;
                   load_queue(queued_titles[counter.title], "title");
               } else {
                   console.log("title finisihed. trying whats after.");
                   get_more_titles();
                   counter.queue = queue_start;
                   get_queue(true);
               }
               break;

           case "start":

               counter.start++;

               if (counter.start % starts_multiplier == 0 && stories_started < stories_they_can_create) {
                   stories_started++;
                   load_queue(null, "start");
               } else {

                   console.log("not ready to start yet.");

                   if (queued_stories[counter.story] || false) {
                       counter.queue = queue_write;
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

       console.log('grabbing titles');

       db.collection("Stories").where('title', "==", 0).where('date_finished', ">", 0).orderBy('date_finished', 'asc').limit(limit_count).get().then((snapshot) => {

               if (!snapshot.empty) {

                   snapshot.forEach((doc) => {

                       if (doc.exists) {

                           story_db = doc.data();
                           story_db.id = doc.id;

                           // THIS IS WHAT DOESN'T ALLOW DOUBLES

                           if (!(user_stories[story_db.id] || false))
                               return;

                           queued_titles.push(story_db.id);

                       }

                   });

               }
           })
           .catch(log_error);

   }


   function get_more_rates() {

       console.log('grabbing rates');

       db.collection("Stories").where('pending_title', "==", null).orderBy('rating.votes', 'asc').limit(limit_count).get().then((snapshot) => {

               if (!snapshot.empty) {

                   snapshot.forEach((doc) => {

                       if (doc.exists) {

                           story_db = doc.data();
                           story_db.id = doc.id;

                           // THIS IS WHAT DOESN'T ALLOW DOUBLES

                           if (!(user_stories[story_db.id] || false))
                               return;

                           queued_rates.push(story_db.id);

                       }

                   });


               }
           })
           .catch(log_error);
   }


   function load_queue(story_id, lets_do_this) {

       // Once we know what type of queue we're loading, do this. Reset everything, then show what we need.


       $("#queue_rating").removeClass();

       $(".queue input").val("");

       $("select").val("");

       $(".queue contributors-wrapper ul, .queue the-title, .queue the-story, .queue suggest-title ul, .queue pending-word").html("");

       $("select, .queue new-word, .queue approval-wrapper, .queue rating-wrapper, .queue suggest-title, .queue the-title, .queue approval-wrapper, .queue new-word .approve, .queue .flag, .queue .error-code").hide();

       if (lets_do_this == "start") {

           document.getElementById("f1").focus();
           $('new-word').css("display", "inline");
           $(".queue h2").html("Write the first word of the next great story");
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

               var story_string = "";

               story_db.story.forEach((value) => {
                   story_string = story_string + value;

               });


               // Load Rating

               var user_rating = null;

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


               // Load contributors 

               story_db.contributors.forEach((one) => {


                   db.collection("Users").doc(one).get().then((un) => {

                       if (un.exists) {

                           var cont = un.data();

                           $(".queue contributors-wrapper ul").append('<li onclick="get_user(\'' + one + '\')">' + cont.displayName + '</li>');
                       } else
                           console.error("Get user name failed.");
                   });

               });


               // Load For Queue 

               if (lets_do_this == "title") {


                   story_db.pending_title.forEach((one, index) => {
                       $(".queue suggest-title ul").prepend("<li> <input type=\"radio\" name=\"title_radio\" value=\"" + (index + 2) + "\" />" + one.title + "</li>");
                   });

                   $(".queue h2").html("Vote On The Title");
                   $(".queue suggest-title ul").append('<li><input type="radio" name=\"title_radio\" value="1"' + ((story_db.pending_title.length === 0) ? " checked" : "") + ' /><input type="text" maxlength="45" id="submit_title" /></li>');


                   $(".queue suggest-title").show();

                   $("#queue_rating").addClass("star_wrap");

                   $(".queue .star_wrap .star").click(function(data) {

                       // You can rate without voting in title mode
                       vote(parseInt($(this).attr("data-value")), story_db);

                   });

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

                       var the_data = doc.data();

                       if (the_data.story.length !== story_db.story.length) {

                           counter.queue--;
                           get_queue(true);

                       }

                       console.log("story updated");

                   });




                   $(".queue approval-wrapper").css("display", "inline");

                   if (story_db.pending_word.word == "[END]") {
                       $("select.end").show();

                       $(".queue h2").html("Is this story finished?");



                   } else {

                       $(".queue h2").html("Approve Or Reject The The Last Word");

                       var pendingword = story_db.pending_word.word;
                       if (punc.indexOf(pendingword.substring(0, 1)) === -1)
                           pendingword = "&nbsp;" + pendingword.trim();
                       $(".queue pending-word").html(pendingword);


                   }
               }

               // shit's loaded now, it was all jquery no promise shere, accept contributors which can wait
               div_loading(true, "queue");


           } else {

               console.log("Error, story doc was not found.");
               $("section .queue").hide();
               queue_loaded = false;
               $("main #error").show();
               $("main").show();

           }

           // ENd of get story promise
       });

       // End of load story function
   }

   // USER ACTION FUNCTIONS

   function approve() {


       db.collection("Users").doc(story_db.pending_word.contributor).get().then((un) => {

           if (un.exists) {

               var cont = un.data();

               $(".queue contributors-wrapper ul").append('<li onclick="get_user(\'' + story_db.pending_word.contributor + '\')">' + cont.displayName + '</li>');

           } else
               console.error("Get newest contributor user name failed.");
       });


       if (story_db.pending_word.word == "[END]") {

           // Last person said we should end the story.

           $("main h2:visible")[0].scrollIntoView();
           //window.scrollTo(0, Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().top) + Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().bottom));

           $(".queue h2").html("Great! Now Rate And Suggest A Title");

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

                   "end_vote": true,
                   "punctuation": $("select.end").val()

               }, { merge: true }).then(() => {
                   console.log("End vote recorded.");

               })
               .catch(log_error);

       } else {
           $(".flag").hide();
           if (story_db.story.length > minimum_story_length) {
               $(".flag").show();
               $(".queue h2").html("Approve Or Reject The Last Word, Or Mark The Story Finished");
           }
           $(".queue the-story").append(story_db.pending_word.word);
           write_next();
       }
   }


   function write_next() {


       $("main h2:visible")[0].scrollIntoView();
       // window.scrollTo(0, Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().top) + Math.abs(document.getElementsByTagName("nav")[0].getBoundingClientRect().bottom));

       $(".queue h2").html("Write the next word");
       $('approval-wrapper').hide();
       // these next 2  appears conditionally
       $(".queue new-word .approve").hide();
       $("select.regular").show();

       $('new-word').css("display", "inline");
       document.getElementById("f1").focus();
   }

   function deny() {

       if (story_db.pending_word.word == "[END]") {
           $(".flag").hide();
           write_next();

       } else {

           div_loading(false, "queue");
           if (gtag || false) {
               gtag('event', "[NO VOTE]", {
                   'event_category': 'Word Submit'
               });
           }
           db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

                   "no_vote": true

               }, { merge: true }).then(() => {
                   console.log("No vote counted.");

                   get_queue(true);

               })
               .catch(log_error);

       }
   }

   $(document).on('keypress', function(e) {
       if (e.which == 13) {
           submit();
       }
   });

   function dictionary_check(passed, sanitized) {

       if (!passed) {
           if (global_user.score > 1000) {
               $(".queue .error-code").html("That word wasn't found in our dictionary. Are you sure you want to submit it?");
               are_you_sure = sanitized;
           } else
               $(".queue .error-code").html("Sorry, that word wasn't found in our dictionary. You need a score of 1,000 to submit non-dictionary words.");
           $(".queue loader-icon").hide();
           $(".queue .error-code").show();

           if (gtag || false) {

               gtag('event', sanitized, {
                   'event_category': 'Dictionary Check Failed'
               });


           }


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
                       console.log("New word posted to new story.");

                       $(".queue loader-icon").hide();
                       get_queue(true);

                   })
                   .catch(log_error);
           }



       }

   }

   function submit(flag_end) {


       if (flag_end) {

           submit_word("[END]");
           div_loading(false, "queue");
           return;

       }

       var sanitized = sanitize($("new-word input").val());

       if (sanitized == "")
           return;
       else if (sanitized == last_entry) {
           $(".queue .error-code").html("You already submitted that word.");
           $(".queue .error-code").show();
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

               console.log(data);
               dictionary_check(data, sanitized);

           }).fail((error) => {

               $(".queue .error-code").html("An error occured submitting that word.");
               $(".queue .error-code").show();
               return;
           });

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
               console.log("New word accepted.");

               $(".queue loader-icon").hide();
               get_queue(true);

           })
           .catch(log_error);

   }

   function vote(num_stars, which_db) {

       console.log(num_stars, which_db);

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


       var new_votes = which_db.rating.votes + 1;
       var new_score = (which_db.rating.votes * which_db.rating.score + num_stars) / new_votes;

       console.log(new_votes, new_score);

       $(".votes_cast").html("(" + new_score.toFixed(2) + " rating - " + new_votes + ((new_votes !== 1) ? " votes)" : " vote)"));

       if (gtag || false) {
           gtag('event', num_stars, {
               'event_category': 'Rating Submit'
           });
       }
       db.collection("Users").doc(global_user.uid).collection("Stories").doc(which_db.id).set({

               "rating": num_stars

           }, { merge: true }).then(() => {
               console.log("Ratigng submitted!");

           })
           .catch(log_error);


   }

   function vote_on_title() {

       var vote = parseInt($('input[name=title_radio]:checked').val() || 0);

       var submit_title = "";

       if (vote < 1)
           return;

       if (vote === 1) {

           submit_title = sanitize($('#submit_title').val());

           if (submit_title == "")
               return;

       }

       if (gtag || false) {
           gtag('event', vote + " " + submit_title, {
               'event_category': 'Title'
           });
       }
       db.collection("Users").doc(global_user.uid).collection("Stories").doc(story_db.id).set({

           "title_vote": vote,
           "submit_title": submit_title

       }, { merge: true }).catch(log_error);

       get_queue(true);

   }


   // PAGE LOADING FUNCTIONS

   function get_story(story_id) {

       div_loading(false, "story");

       db.collection("Stories").doc(story_id).get().then((doc) => {

           if (doc.exists) {

               read_db = doc.data();
               read_db.id = story_id;

               // Load Story Basics 
               var story_string = "";

               read_db.story.forEach((value) => {
                   story_string = story_string + value;
               });
               $(".story the-story").html(story_string);


               // Load Title

               var page_title = "";
               if (read_db.title) {
                   $(".story the-title").show();
                   $(".story the-title").html(read_db.title);
                   page_title = '"' + read_db.title + '"';
               } else
                   $(".story the-title").hide();

               history.pushState({
                   "page": "story"
               }, "Basher! Story " + page_title, "https://basher.app/?show=story&id=" + read_db.id);



               if (typeof addthis !== "undefined") {

                   addthis.update('share', 'url', "https://basher.app/?show=story&id=" + read_db.id);
                   addthis.update('share', 'title', "Basher! Story: " + page_title);
                   addthis.update('share', 'description', "Read this story written one word at a time by people of the Internet.");
                   addthis.update('share', 'media', "https://basher.app/images/logo.png");
               }



               // Load Rating
               $(".story rating-wrapper .votes_cast").html("(" + read_db.rating.score.toFixed(2) + " rating - " + read_db.rating.votes + ((read_db.rating.votes !== 1) ? " votes)" : " vote)"));
               $("#story_rating").removeClass();

               var user_rating = null;


               if (user_stories[read_db.id] || false)
                   user_rating = (user_stories[read_db.id].rating || null);

               $("#story_rating").html(star(read_db.rating.score, user_rating));

               if ((global_user.uid || false) && (read_db.date_finished > 0)) {

                   $("#story_rating").addClass("star_wrap " + read_db.id);

                   $(".story .star_wrap .star").click(function(data) {
                       vote(parseInt($(this).attr("data-value")), read_db);
                   });

               }

               // Load contributors 

               $(".story contributors-wrapper ul").html("");
               read_db.contributors.forEach((one) => {

                   db.collection("Users").doc(one).get().then((un) => {

                       if (un.exists) {

                           var cont = un.data();

                           $(".story contributors-wrapper ul").append('<li onclick="get_user(\'' + one + '\')">' + cont.displayName + '</li>');
                       } else
                           console.log("Get user name failed.");
                   });
               });

               // Doen
               div_loading(true, "story");

           } else {
               console.log("No story doc found.");
           }
       });
   }

   function get_signin() {
       history.pushState({
           "page": "start"
       }, "Basher!  Write One Word Of The Next Great Story", "https://basher.app/?show=start");
       div_loading(true, 'start', true);
   }


   function get_user(diff_user) {


       div_loading(false, "user");

       $(".your_stories").hide();
       $(".started_stories").hide();
       $(".favorite_stories").hide();
       $("user-settings").hide();
       $(".recent_words").hide();
       $("recent-words").html("");


       if (diff_user && diff_user !== global_user.uid) {

           db.collection("Users").doc(diff_user).get().then((doc) => {

               if (doc.exists) {

                   var local_user = doc.data();
                   local_user.uid = doc.id;

                   history.pushState({
                       "page": "user"
                   }, "Basher! Profile: " + local_user.displayName, "https://basher.app/?show=profile&id=" + local_user.uid);



                   process_user(local_user);

               } else
                   console.error("User doc doesn't exist.");

           });

       } else {

           // add settings  if its your profile we're loading

           $("user-settings").show();
           $(".email").html(global_user.email);

           history.pushState({
               "page": "user"
           }, "Basher! Your Profile", "https://basher.app/?show=profile");

           process_user(global_user);

       }

   }

   function process_user(local_user) {

       local_user.photoURL = local_user.photoURL || "https://basher.app/images/user.png";

       $("#user_h2").html("<a href=\"https://basher.app/?show=profile&id=" + local_user.uid + "\"><span " + ((local_user == global_user) ? 'class="user_id">' : ">") + local_user.displayName + "</span> <span " + ((local_user == global_user) ? 'class="score" ' : 'class="other_score" ') + ">" + numberWithCommas(local_user.score) + "</span></a>");

       $("#change_photo").prop("disabled", true);
       $("user-photo").removeClass("self");

       if (local_user.recent_words.length > 0) {

           $(".user .recent_words").show();

           for (i = 0; i < local_user.recent_words.length && i < number_of_recent_words; i++) {

               if (i > 0)
                   $("recent-words").append(", ");

               $("recent-words").append(local_user.recent_words[local_user.recent_words.length - 1 - i]);
           }

       }

       if (local_user.photoURL == global_user.photoURL) {
           $("user-photo").addClass("self");
           $("#change_photo").prop("disabled", false);
           $("user-photo").html('<img src="' + my_photo_url + '">');

       } else if (local_user.photoURL.substring(0, 5) === "https")
           $("user-photo").html('<img src="' + local_user.photoURL + '">');

       else {

           var starsRef = storage.ref().child("Custom_Photos/" + local_user.photoURL);

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

           db.collection("Stories").where("contributors", "array-contains", local_user.uid).orderBy('rating', 'desc').limit(limit_count).get().then((snapshot) => {

               process_snapshot(snapshot, which_type);

               div_loading(true, "user");


           }).catch(log_error);
       } else if (which_type == "favorite") {

           //  console.log("loading favorited stories");

           db.collection("Stories").where("favorites", "array-contains", local_user.uid).orderBy('date_finished', 'desc').limit(limit_count).get().then((snapshot) => {

               process_snapshot(snapshot, which_type);

               div_loading(true, "user");


           }).catch(log_error);
       } else if (which_type == "recent") {

           db.collection("Stories").orderBy('date_finished', 'desc').limit(limit_count).get().then((snapshot) => {

               //   console.log("loading recently finished stories");

               process_snapshot(snapshot, which_type);

               div_loading(true, "recent_stories");


           }).catch(log_error);

       } else if (which_type == "top") {

           db.collection("Stories").orderBy('rating', 'desc').limit(limit_count).get().then((snapshot) => {

               //   console.log("loading highest rated stories");

               process_snapshot(snapshot, which_type);
               div_loading(true, "top_stories");


           }).catch(log_error);

       }

   }


   function process_snapshot(snapshot, which_type) {

       var stories = [];

       snapshot.forEach((doc) => {
           if (doc.exists) {
               var data = doc.data();
               data.id = doc.id;
               stories.push(data);

           } else {
               console.log("This story in the list doesn't exist.", doc);
           }
       });

       $("." + which_type + "_stories table").html("<tr><th>Story</th><th>Rating</th><th class=\"date\">Completed</th></tr>");

       // Your stories also includes a "started" stories table, which is your stories but where your word is first

       if (which_type === "your") {
           $(".started_stories table").html("<tr><th>Story</th><th>Rating</th><th class=\"date\">Completed</th></tr>");
       }


       stories.forEach((the_story, index) => {

           var story_string = "";

           the_story.story.forEach((value) => {
               story_string = story_string + value;

           });

           var the_date = in_progress_string;

           if (the_story.date_finished) {
               var new_date = new Date(parseInt(the_story.date_finished));
               the_date = (new_date.getMonth() + 1) + '/' + new_date.getDate() + '/' + new_date.getFullYear();
           }

           var title = story_string;
           var is_long = false;

           if (the_story.title)
               title = the_story.title;
           else
               is_long = true; // elipses after non titles?

           if (title.length > 33)
               title = title.substring(0, title.lastIndexOf(" ", 30));

           if (punc.indexOf(title.substring(title.length - 1)) > -1)
               title = title.substring(0, title.length - 1);

           if (is_long)
               title = title + "...";

           var user_rating = null;

           if (user_stories || false) {

               if (user_stories[the_story.id || false])
                   user_rating = (user_stories[the_story.id].rating || null);

           }

           // if the first word was written by this user, flip it to started stories (not in both)

           if (which_type === "your" && the_story.contributors[0] == global_user.uid)
               which_type = "started";

           $("." + which_type + "_stories table").append("<tr class=\"" + the_story.id + "\"><td class=\"title\" onclick=\"get_story('" + the_story.id + "')\">" + title + "</td><td class=\"rating\">" + star(the_story.rating.score, user_rating) + "</td><td class=\"date\">" + the_date + "</td></tr>");


           if (index < 2)
               $('.' + which_type + '_stories').show();

           // Flip it back, because we're in a loop still
           if (which_type === "started")
               which_type = "your";

       });

   }

   function get_top_stories() {

       history.pushState({
           "page": "top"
       }, "Basher! Top Stories", "https://basher.app/?show=top");


       if (top_stories_loaded) {

           div_loading(true, "top_stories", true);

           return;

       }

       div_loading(false, "top_stories");

       top_stories_loaded = true;

       get_stories("top", global_user);

   }


   function get_recent_stories() {

       history.pushState({
           "page": "recent"
       }, "Basher! Just Finished", "https://basher.app/?show=recent");


       if (recent_stories_loaded) {

           div_loading(true, "recent_stories", true);

           return;

       }

       div_loading(false, "recent_stories");

       recent_stories_loaded = true;

       get_stories("recent", global_user);

   }