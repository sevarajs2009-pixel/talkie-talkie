import { auth, app } from "./firebase.js";

import {
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const db = getFirestore(app);


// ========================================
// GOOGLE SIGN UP BUTTON
// ========================================

const googleSignupButton =
    document.getElementById("google-signup-button");


// Stop if the button does not exist
if (!googleSignupButton) {

    console.error(
        "Google signup button not found."
    );

} else {

    googleSignupButton.addEventListener(
        "click",
        async () => {

            googleSignupButton.disabled = true;

            const btnText =
                document.getElementById("btnText");

            const spinner =
                document.getElementById("spinner");


            if (btnText) {
                btnText.textContent =
                    "Connecting...";
            }

            if (spinner) {
                spinner.classList.remove("hidden");
            }


            try {

                // ========================================
                // GOOGLE AUTHENTICATION
                // ========================================

                const provider =
                    new GoogleAuthProvider();

                provider.addScope("profile");
                provider.addScope("email");


                const result =
                    await signInWithPopup(
                        auth,
                        provider
                    );


                const user = result.user;


                console.log(
                    "Google authentication successful:",
                    user.uid
                );

                console.log(
                    "Google name:",
                    user.displayName
                );

                console.log(
                    "Google email:",
                    user.email
                );


                // ========================================
                // CHECK TALKIE TALKIE PROFILE
                // ========================================

                const userRef =
                    doc(db, "users", user.uid);

                const userDoc =
                    await getDoc(userRef);


                // ========================================
                // EXISTING USER
                // ========================================

                if (userDoc.exists()) {

                    console.log(
                        "Existing Talkie Talkie user."
                    );

                    alert(
                        "Login successful!"
                    );

                    window.location.href =
                        "/dashboard.html";

                    return;
                }


                // ========================================
                // CREATE NEW GOOGLE USER PROFILE
                // ========================================

                const googleName =
                    user.displayName ||
                    "TalkieTalkie User";


                const googleEmail =
                    user.email ||
                    "";


                // ========================================
                // AUTOMATIC USERNAME
                // ========================================
                // The user no longer needs to type
                // a username.
                //
                // We create one automatically using
                // the Google name + part of Firebase UID.
                // ========================================

                let username =
                    googleName
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, "")
                        .substring(0, 20);


                if (!username) {
                    username = "user";
                }


                username =
                    username +
                    "_" +
                    user.uid.substring(0, 6);


                console.log(
                    "Generated username:",
                    username
                );


                // ========================================
                // SAVE USER PROFILE
                // ========================================

                await setDoc(
                    userRef,
                    {
                        uid: user.uid,

                        fullName: googleName,

                        username: username,

                        email: googleEmail,

                        // These fields are no longer
                        // collected during signup.
                        age: null,

                        gender: null,

                        country: null,

                        authProvider: "google",

                        createdAt:
                            new Date().toISOString()
                    }
                );


                console.log(
                    "New Google user profile saved to Firestore."
                );


                // ========================================
                // SUCCESS
                // ========================================

                alert(
                    "Account created successfully!"
                );


                window.location.href =
                    "/dashboard.html";


            } catch (error) {

                console.error(
                    "Google signup error:",
                    error
                );


                // ========================================
                // ERROR HANDLING
                // ========================================

                if (
                    error.code ===
                    "auth/popup-closed-by-user"
                ) {

                    alert(
                        "Google sign-in was cancelled."
                    );


                } else if (
                    error.code ===
                    "auth/account-exists-with-different-credential"
                ) {

                    alert(
                        "An account already exists with this email. Please use your existing login method."
                    );


                } else if (
                    error.code ===
                    "auth/popup-blocked"
                ) {

                    alert(
                        "Google sign-in popup was blocked. Please allow popups for this site."
                    );


                } else if (
                    error.code ===
                    "auth/unauthorized-domain"
                ) {

                    alert(
                        "Google sign-in is not enabled for this website domain in Firebase."
                    );


                } else if (
                    error.code ===
                    "permission-denied"
                ) {

                    alert(
                        "Google account connected, but Talkie Talkie could not save your profile."
                    );


                } else {

                    alert(
                        "Google sign-up failed: " +
                        error.message
                    );
                }


            } finally {

                googleSignupButton.disabled =
                    false;


                if (btnText) {

                    btnText.textContent =
                        "Continue with Google";
                }


                if (spinner) {

                    spinner.classList.add(
                        "hidden"
                    );
                }
            }
        }
    );
}