import { auth, app } from "./firebase.js";

import {
    GoogleAuthProvider,
    signInWithPopup,
    signOut
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


                // ========================================
                // CHECK TALKIE TALKIE PROFILE
                // ========================================

                const userRef =
                    doc(db, "users", user.uid);

                const userDoc =
                    await getDoc(userRef);


                // ========================================
                // EXISTING TALKIE TALKIE ACCOUNT
                // ========================================

                if (userDoc.exists()) {

                    console.log(
                        "Existing Talkie Talkie account detected."
                    );


                    // This is Signup page,
                    // so do NOT log the user into Dashboard.

                    await signOut(auth);


                    alert(
                        "This Google account already has a Talkie Talkie account. Please go to the Login page to log in."
                    );


                    window.location.href =
                        "/login.html";


                    return;
                }


                // ========================================
                // NEW GOOGLE USER
                // ========================================

                console.log(
                    "No Talkie Talkie account found."
                );


                // Do NOT create a Firestore profile.
                // Do NOT redirect to Dashboard.
                //
                // Sign out immediately so the Google
                // authentication does not remain active.

                await signOut(auth);


                alert(
                    "You need to create a Talkie Talkie account to use Talkie Talkie."
                );


                // Stay on Signup page.


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
                        "An account already exists with this Google email. Please go to the Login page."
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
                        "Talkie Talkie could not check your account. Please try again."
                    );


                } else {

                    alert(
                        "Google signup failed: " +
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