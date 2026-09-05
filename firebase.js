import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAo-ILgAVn0JFFFX-v5dnnPXNPh6qE5ztg",
    authDomain: "talkietalkie-a9a53.firebaseapp.com",
    projectId: "talkietalkie-a9a53",
    storageBucket: "talkietalkie-a9a53.firebasestorage.app",
    messagingSenderId: "968488304687",
    appId: "1:968488304687:web:4bbcc656ec6e4443bc46da",
    measurementId: "G-KTW6MHTHYL"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const auth = getAuth(app);

export { app, auth };