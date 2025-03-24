document.getElementById('uploadForm').addEventListener('submit', function(event) {
    event.preventDefault();
    
    let formData = new FormData();
    formData.append("file", document.getElementById("imageInput").files[0]);
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if(data.frames) {
            let framesContainer = document.getElementById('framesContainer');
            framesContainer.innerHTML = '';
            data.frames.forEach(frame => {
                let frameDiv = document.createElement('div');
                frameDiv.classList.add('frame');
                frameDiv.style.backgroundImage = `url(${frame})`;
                framesContainer.appendChild(frameDiv);
            });
        }
    })
    .catch(error => console.error('Error:', error));
});
