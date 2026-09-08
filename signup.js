import { auth, app } from "./firebase.js";

import {
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const db = getFirestore(app);

const signupForm = document.getElementById("signup-form");
const otpSection = document.getElementById("otp-section");
const emailField = document.getElementById("email-field");
const otpInput = document.getElementById("otp");
const verifyOtpButton = document.getElementById("verify-otp-button");

const signupButton = signupForm.querySelector('button[type="submit"]');


const resendOtpButton = document.getElementById("resend-otp-button");

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
    signupButton.disabled = !(
    hasLength &&
    hasUppercase &&
    hasLowercase &&
    hasNumber &&
    hasSpecial
);
});

let resendTimer = 30;
let resendInterval = null;

function startResendCountdown() {
    resendOtpButton.disabled = true;
    resendTimer = 30;

    resendOtpButton.textContent = `Resend OTP (${resendTimer}s)`;

    if (resendInterval) {
        clearInterval(resendInterval);
    }

    resendInterval = setInterval(() => {
        resendTimer--;

        resendOtpButton.textContent = `Resend OTP (${resendTimer}s)`;

        if (resendTimer <= 0) {
            clearInterval(resendInterval);
            resendInterval = null;

            resendOtpButton.disabled = false;
            resendOtpButton.textContent = "Resend OTP";
        }
    }, 1000);
}

let pendingSignupData = null;


// ========================================
// STEP 1 — SIGN UP FORM
// ========================================

signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value.trim();
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const age = parseInt(document.getElementById("age").value, 10);
    const gender = document.getElementById("gender").value;
    const country = document.getElementById("country").value;
    const password = document.getElementById("password").value;

    // Validate fields
    if (
        !fullName ||
        !username ||
        !email ||
        !age ||
        !gender ||
        !country ||
        !password
    ) {
        alert("Please fill out all required fields.");
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

    // Disable signup button while sending OTP
    signupButton.disabled = true;
    signupButton.textContent = "Sending Code...";

    try {
        // ========================================
        // REQUEST OTP
        // ========================================

        const response = await fetch("/api/signup/send-otp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            alert(data.message || "Could not send verification code.");

            signupButton.disabled = false;
            signupButton.textContent = "Sign Up";

            pendingSignupData = null;

            return;
        }

        // Development testing only
        console.log("TEST OTP:", data.testOtp);

        // ========================================
        // SHOW OTP SECTION
        // ========================================
        emailField.replaceWith(otpSection);
        otpSection.classList.remove("hidden");
        

        otpInput.value = "";
        otpInput.focus();

        signupButton.textContent = "Code Sent ✓";

        startResendCountdown();

        // Scroll OTP box into view
        otpSection.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    } catch (error) {
        console.error("OTP request failed:", error);

        alert("Could not connect to the server.");

        signupButton.disabled = false;
        signupButton.textContent = "Sign Up";

        pendingSignupData = null;
    }
});


// ========================================
// STEP 2 — VERIFY OTP
// ========================================

resendOtpButton.addEventListener("click", async () => {

    if (!pendingSignupData) {
        alert("Please enter your signup details first.");
        return;
    }

    resendOtpButton.disabled = true;
    resendOtpButton.textContent = "Sending...";

    try {
        const response = await fetch("/api/signup/send-otp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: pendingSignupData.email
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            alert(data.message || "Could not resend verification code.");
            resendOtpButton.disabled = false;
            resendOtpButton.textContent = "Resend OTP";
            return;
        }

        otpInput.value = "";
        otpInput.focus();

        alert("A new verification code has been sent to your email.");

        startResendCountdown();

    } catch (error) {

        console.error("Resend OTP failed:", error);

        alert("Could not resend the verification code.");

        resendOtpButton.disabled = false;
        resendOtpButton.textContent = "Resend OTP";
    }
});


verifyOtpButton.addEventListener("click", async () => {

    if (!pendingSignupData) {
        alert("Please request a verification code first.");
        return;
    }

    const enteredOtp = otpInput.value.trim();

    // Validate OTP
    if (!/^\d{6}$/.test(enteredOtp)) {
        alert("Please enter the 6-digit verification code.");
        otpInput.focus();
        return;
    }

    verifyOtpButton.disabled = true;
    verifyOtpButton.textContent = "Verifying...";

    try {

        // ========================================
        // VERIFY OTP WITH SERVER
        // ========================================

        const verifyResponse = await fetch("/api/signup/verify-otp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: pendingSignupData.email,
                otp: enteredOtp
            })
        });

        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok || !verifyData.success) {

            alert(
                verifyData.message ||
                "Invalid verification code."
            );

            verifyOtpButton.disabled = false;
            verifyOtpButton.textContent = "Verify OTP";

            otpInput.focus();

            return;
        }

        // ========================================
        // OTP VERIFIED
        // ========================================

        verifyOtpButton.textContent = "Verified ✓";

        console.log("OTP verified successfully.");

        // Now create Firebase account
        await createFirebaseAccount();

    } catch (error) {

        console.error("OTP verification failed:", error);

        alert("Could not verify the code. Please try again.");

        verifyOtpButton.disabled = false;
        verifyOtpButton.textContent = "Verify OTP";
    }
});


// ========================================
// STEP 3 — CREATE FIREBASE ACCOUNT
// ========================================

async function createFirebaseAccount() {

    try {

        verifyOtpButton.textContent = "Creating Account...";

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

        const userCredential =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

        const user = userCredential.user;

        console.log(
            "Firebase user created:",
            user.uid
        );


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

        verifyOtpButton.disabled = false;
        verifyOtpButton.textContent = "Verify OTP";


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