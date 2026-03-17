import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

function showFatal(message: string) {
    const el = document.createElement("pre");
    el.style.whiteSpace = "pre-wrap";
    el.style.padding = "16px";
    el.style.margin = "0";
    el.style.height = "100vh";
    el.style.boxSizing = "border-box";
    el.style.background = "#07060b";
    el.style.color = "white";
    el.textContent = message;
    document.body.innerHTML = "";
    document.body.appendChild(el);
}

window.addEventListener("error", (e) => {
    showFatal(`window.error:\n${e.message}\n\n${String((e as ErrorEvent).error?.stack ?? "")}`);
});

window.addEventListener("unhandledrejection", (e) => {
    showFatal(`unhandledrejection:\n${String((e as PromiseRejectionEvent).reason)}`);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);