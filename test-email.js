app.get("/test-email", async (req, res) => {
  try {
    await sendEmail("This is a test email sent from my deployed app.", "test-call");
    res.send("Test email sent successfully!");
  } catch (error) {
    res.status(500).send("Error sending test email: " + error.message);
  }
});
