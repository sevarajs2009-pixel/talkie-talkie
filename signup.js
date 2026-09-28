import { auth, app } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
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

const signupForm = document.getElementById("signup-form");


const signupButton = signupForm.querySelector('button[type="submit"]');
let pendingSignupData = null;

// Google signup mode
let googleSignupUser = null;




// ========================================
// LIVE PASSWORD CHECKER
// ========================================

const passwordInput = document.getElementById("password");

const reqLength = document.getElementById("req-length");
const reqUppercase = document.getElementById("req-uppercase");
const reqLowercase = document.getElementById("req-lowercase");
const reqNumber = document.getElementById("req-number");
const reqSpecial = document.getElementById("req-special");

function updatePasswordRequirement(element, valid) {
    const text = element.textContent.replace(/^❌ |^✅ /, "");

    element.textContent = valid
        ? "✅ " + text
        : "❌ " + text;
}

passwordInput.addEventListener("input", () => {

    const password = passwordInput.value;

    const hasLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    updatePasswordRequirement(reqLength, hasLength);
    updatePasswordRequirement(reqUppercase, hasUppercase);
    updatePasswordRequirement(reqLowercase, hasLowercase);
    updatePasswordRequirement(reqNumber, hasNumber);
    updatePasswordRequirement(reqSpecial, hasSpecial);
    // Google users do not need a password
if (googleSignupUser) {
    signupButton.disabled = false;
} else {
    signupButton.disabled = !(
        hasLength &&
        hasUppercase &&
        hasLowercase &&
        hasNumber &&
        hasSpecial
    );
}
});





signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value.trim();
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const age = parseInt(document.getElementById("age").value, 10);
    const gender = document.getElementById("gender").value;
    const country = document.getElementById("country").value;
    const password = document.getElementById("password").value;

    // ========================================
// VALIDATE FIELDS
// ========================================

if (
    !fullName ||
    !username ||
    !email ||
    !age ||
    !gender ||
    !country
) {
    alert("Please fill out all required fields.");
    return;
}

// Password is required only for normal signup
if (!googleSignupUser && !password) {
    alert("Please enter a password.");
    return;
}

    // Age validation
    if (age < 13) {
        alert("You must be at least 13 years old to register.");
        return;
    }

    // Save signup information temporarily
pendingSignupData = {
    fullName,
    username,
    email,
    age,
    gender,
    country,
    password
};

    signupButton.disabled = true;
    signupButton.textContent = "Creating Account...";

    try {
        await createFirebaseAccount();

    } catch (error) {
        console.error("Signup error:", error);

        signupButton.disabled = false;
        signupButton.textContent = "Sign Up";
        pendingSignupData = null;
    }
});


// ========================================
// STEP 3 — CREATE FIREBASE ACCOUNT
// ========================================
async function createFirebaseAccount() {

    try {

        signupButton.textContent = "Creating Account...";

        const {
            fullName,
            username,
            email,
            age,
            gender,
            country,
            password
        } = pendingSignupData;


        // ========================================
        // CREATE AUTH ACCOUNT
        // ========================================
// ========================================
// CREATE / USE AUTH ACCOUNT
// ========================================

let user;

if (googleSignupUser) {

    // Google account is already authenticated
    user = googleSignupUser;

    console.log(
        "Using existing Google Firebase user:",
        user.uid
    );

} else {

    // Normal email/password signup
    const userCredential =
        await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

    user = userCredential.user;

    console.log(
        "Firebase user created:",
        user.uid
    );
}


        // ========================================
        // SAVE USER PROFILE
        // ========================================

        await setDoc(
            doc(db, "users", user.uid),
            {
                uid: user.uid,
                fullName: fullName,
                username: username,
                email: email,
                age: age,
                gender: gender,
                country: country
            }
        );

        console.log(
            "User profile saved to Firestore."
        );


        // ========================================
        // SUCCESS
        // ========================================

        alert("Account created successfully!");

        window.location.href = "/dashboard.html";


    } catch (error) {

        console.error(
            "Firebase signup error:",
            error
        );

        signupButton.disabled = false;
signupButton.textContent = "Sign Up";


        if (error.code === "auth/email-already-in-use") {

            alert(
                "This email is already registered."
            );

        } else if (error.code === "auth/invalid-email") {

            alert(
                "Please enter a valid email address."
            );

        } else if (
            error.code === "auth/weak-password" ||
            error.code ===
            "auth/password-does-not-meet-requirements"
        ) {

            alert(
                "Password must contain lowercase, uppercase, number, and special character."
            );

        } else if (
            error.code === "permission-denied"
        ) {

            alert(
                "Account created, but Firestore permission was denied."
            );

        } else {

            alert(
                "Signup failed: " +
                error.message
            );
        }
    }
}
// ========================================
// GOOGLE SIGN UP
// ========================================

const googleSignupButton =
    document.getElementById("google-signup-button");

if (googleSignupButton) {

    googleSignupButton.addEventListener("click", async () => {

        googleSignupButton.disabled = true;
        googleSignupButton.textContent = "Connecting...";

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
                "Google authentication successful:",
                user.uid
            );

            console.log("Google name:", user.displayName);
            console.log("Google email:", user.email);
            console.log("Google photo:", user.photoURL);

            // Check whether TalkieTalkie profile already exists
            const userDoc = await getDoc(
                doc(db, "users", user.uid)
            );

            // ========================================
            // EXISTING TALKIETALKIE USER
            // ========================================

            if (userDoc.exists()) {

                alert("Login successful!");

                window.location.href =
                    "/dashboard.html";

                return;
            }

            // ========================================
            // NEW GOOGLE USER
            // ========================================

            googleSignupUser = user;

            // Fill information Google already provides
            const fullNameInput =
                document.getElementById("fullName");

            const emailInput =
                document.getElementById("email");

            if (fullNameInput && user.displayName) {
                fullNameInput.value =
                    user.displayName;
            }

            if (emailInput && user.email) {
                emailInput.value =
                    user.email;

                // Email came from Google.
                // User does not need to type it again.
                emailInput.readOnly = true;
            }

            alert(
                "Google account connected! Please complete your TalkieTalkie profile."
            );

            console.log(
                "New Google user ready for profile completion."
            );

        } catch (error) {

            console.error(
                "Google sign-in error:",
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

            } else {

                alert(
                    "Google sign-in failed: " +
                    error.message
                );
            }

        } finally {

            googleSignupButton.disabled = false;

            googleSignupButton.textContent =
                "Continue with Google";
        }
    });
}