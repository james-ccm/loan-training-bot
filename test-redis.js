// This should be near the top of your file, where you set up Express.
app.get("/test-redis", async (req, res) => {
  try {
    // Write a test key
    await redisClient.set("testKey", "Hello from Cloud Run!");

    // Read the test key
    const value = await redisClient.get("testKey");

    // Return success if we can read the value
    res.send(`Redis connection success! Value: ${value}`);
  } catch (err) {
    console.error("Redis test error:", err);
    res.status(500).send(`Redis test failed: ${err.message}`);
  }
});
