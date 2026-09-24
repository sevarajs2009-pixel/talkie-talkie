import { auth, app } from "./firebase.js";
import {
    getFirestore,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const db = getFirestore(app);
import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const loginForm = document.getElementById("login-form");

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("username-input").value.trim();
    const password = document.getElementById("password-input").value;

    if (!email || !password) {
        alert("Please enter your email and password.");
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        console.log("Firebase login successful:", userCredential.user.uid);

        alert("Login successful!");

        window.location.href = "/dashboard.html";

    } catch (error) {
        console.error("Firebase login error:", error);

        if (error.code === "auth/invalid-credential") {
            alert("Incorrect email or password.");
        } else if (error.code === "auth/user-not-found") {
            alert("No account found with this email.");
        } else if (error.code === "auth/wrong-password") {
            alert("Incorrect password.");
        } else if (error.code === "auth/invalid-email") {
            alert("Please enter a valid email address.");
        } else {
            alert("Login failed: " + error.message);
        }
    }
});
// ========================================
// GOOGLE LOGIN
// ========================================

const googleLoginButton =
    document.getElementById("google-login-button");

if (googleLoginButton) {

    googleLoginButton.addEventListener("click", async () => {

        googleLoginButton.disabled = true;
        googleLoginButton.textContent = "Connecting...";

        try {

            const provider = new GoogleAuthProvider();

            const result = await signInWithPopup(
                auth,
                provider
            );

            const user = result.user;

            console.log(
                "Google login successful:",
                user.uid
            );

            // Check whether TalkieTalkie profile exists
            const userDoc = await getDoc(
                doc(db, "users", user.uid)
            );

            if (!userDoc.exists()) {

                alert(
                    "Google account authenticated, but no TalkieTalkie profile was found. Please sign up first."
                );

                return;
            }

            alert("Login successful!");

            window.location.href = "/dashboard.html";

        } catch (error) {

            console.error(
                "Google login error:",
                error
            );

            if (
                error.code ===
                "auth/popup-closed-by-user"
            ) {

                alert("Google sign-in was cancelled.");

            } else if (
                error.code ===
                "auth/popup-blocked"
            ) {

                alert(
                    "Google sign-in popup was blocked. Please allow popups for this site."
                );

            } else {

                alert(
                    "Google sign-in failed: " +
                    error.message
                );
            }

        } finally {

            googleLoginButton.disabled = false;
            googleLoginButton.textContent =
                "Continue with Google";
        }
    });
}