import { auth, app } from "./firebase.js";

import {
    getFirestore,
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";


const db = getFirestore(app);

const googleLoginButton =
    document.getElementById("google-login-button");

const btnText =
    document.getElementById("btnText");

const spinner =
    document.getElementById("spinner");


if (googleLoginButton) {

    googleLoginButton.addEventListener("click", async () => {

        googleLoginButton.disabled = true;

        if (btnText) {
            btnText.textContent = "Connecting...";
        }

        if (spinner) {
            spinner.classList.remove("hidden");
        }


        try {

            const provider = new GoogleAuthProvider();

            provider.addScope("profile");
            provider.addScope("email");


            const result = await signInWithPopup(
                auth,
                provider
            );


            const user = result.user;


            console.log(
                "Google login successful:",
                user.uid
            );


            // Check TalkieTalkie profile
            const userRef =
                doc(db, "users", user.uid);

            const userDoc =
                await getDoc(userRef);


            // ========================================
            // EXISTING USER
            // ========================================

            if (userDoc.exists()) {

                console.log(
                    "Existing TalkieTalkie profile found."
                );

                alert("Login successful!");

                window.location.href =
                    "/dashboard.html";

                return;
            }


            // ========================================
            // NEW GOOGLE USER
            // ========================================

            console.log(
                "New Google user. Creating TalkieTalkie profile..."
            );


            const baseUsername =
                (user.displayName || "TalkieTalkieUser")
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .substring(0, 20);


            const username =
                baseUsername +
                "_" +
                user.uid.substring(0, 6);


            await setDoc(userRef, {

                uid: user.uid,

                fullName:
                    user.displayName ||
                    "TalkieTalkie User",

                username: username,

                email:
                    user.email || "",

                age: null,

                gender: null,

                country: null,

                authProvider: "google",

                createdAt:
                    new Date().toISOString()

            });


            console.log(
                "TalkieTalkie profile created."
            );


            alert(
                "Account created successfully!"
            );


            window.location.href =
                "/dashboard.html";


        } catch (error) {

            console.error(
                "Google login error:",
                error
            );


            if (
                error.code ===
                "auth/popup-closed-by-user"
            ) {

                alert(
                    "Google sign-in was cancelled."
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
                "auth/account-exists-with-different-credential"
            ) {

                alert(
                    "An account already exists with this email using another login method."
                );


            } else if (
                error.code ===
                "permission-denied"
            ) {

                alert(
                    "Firebase permission denied. Please check Firestore rules."
                );


            } else {

                alert(
                    "Google sign-in failed: " +
                    error.message
                );

            }

        } finally {

            googleLoginButton.disabled = false;

            if (btnText) {
                btnText.textContent =
                    "Continue with Google";
            }

            if (spinner) {
                spinner.classList.add("hidden");
            }

        }

    });

}