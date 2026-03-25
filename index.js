function waUploadMedia(media) {
    const formData = new FormData();
    formData.append('file', media);
    return axiosWA.post(`/${PHONE_ID}/media`, formData) // Add appropriate Content-Type if needed
        .then(response => response.data.id);
}

function waSendMessage(to, body, mediaId) {
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: body },
        media: { id: mediaId }
    };
    return axiosWA.post(`/${PHONE_ID}/messages`, payload);
}