const backendUrl = "https://animegan-video-frame-generator-back.onrender.com";

document.getElementById("upload-form").addEventListener("submit", async function(event) {
    event.preventDefault();

    let formData = new FormData();
    let fileInput = document.getElementById("image-input");

    if (fileInput.files.length === 0) {
        alert("Veuillez sélectionner une image !");
        return;
    }

    formData.append("file", fileInput.files[0]);

    let response = await fetch(`${backendUrl}/upload`, {
        method: "POST",
        body: formData
    });

    let data = await response.json();

    let framesOutput = document.getElementById("frames-output");
    framesOutput.innerHTML = "";

    data.frames.forEach(frame => {
        let img = document.createElement("img");
        img.src = `${backendUrl}/${frame}`;
        framesOutput.appendChild(img);
    });
});
