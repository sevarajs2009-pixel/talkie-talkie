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

signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value.trim();
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const age = parseInt(document.getElementById("age").value, 10);
    const gender = document.getElementById("gender").value;
    const country = document.getElementById("country").value;
    const password = document.getElementById("password").value;

    if (!fullName || !username || !email || !age || !gender || !country || !password) {
        alert("Please fill out all required fields.");
        return;
    }

    if (age < 13) {
        alert("You must be at least 13 years old to register.");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        const user = userCredential.user;

        console.log("Firebase user created:", user.uid);

        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            fullName: fullName,
            username: username,
            email: email,
            age: age,
            gender: gender,
            country: country
        });

        console.log("User profile saved to Firestore.");

        alert("Account created successfully!");

        window.location.href = "/login.html";

    } catch (error) {
        console.error("Firebase signup error:", error);

        if (error.code === "auth/email-already-in-use") {
            alert("This email is already registered.");
        } else if (error.code === "auth/invalid-email") {
            alert("Please enter a valid email address.");
        } else if (error.code === "auth/weak-password") {
            alert("Password is too weak. Please choose a stronger password.");
        } else if (error.code === "permission-denied") {
            alert("Account created, but Firestore permission was denied.");
        } else {
            alert("Signup failed: " + error.message);
        }
    }
});