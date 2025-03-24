const redis = require("redis");
const client = redis.createClient({
  url: "redis://10.214.16.6"  // Replace with your instance's private IP
});