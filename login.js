import { auth } from "./firebase.js";

import {
    signInWithEmailAndPassword
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