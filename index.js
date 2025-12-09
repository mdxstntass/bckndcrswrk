require("dotenv").config();
const path = require("path");
const express = require("express");
const morgan = require("morgan");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || "cst3144";

// Warn early if DB connection string is missing; server still starts but rejects requests until DB connects
if (!MONGO_URL) {
  console.warn("MONGO_URL not set. Set it in .env before starting the server.");
}

// Parse JSON bodies so req.body is available for POST/PUT/PATCH
app.use(express.json());

// Basic CORS (mirrors incoming origin; allows common methods/headers for browsers during local dev)
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// HTTP request logger with ISO timestamp for easier debugging
app.use(
  morgan((tokens, req, res) => {
    const time = tokens["date"](req, res, "iso");
    return `[${time}] ${tokens.method(req, res)} ${tokens.url(
      req,
      res
    )} ${tokens.status(req, res)} ${tokens["response-time"](req, res)}ms`;
  })
);

// Static images under /images
const imagesDir = path.join(__dirname, "public", "images");
app.use("/images", express.static(imagesDir));

let client;
let db;

// Establish MongoDB connection and select DB; stored in module scope for reuse
async function connectDb() {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  console.log("Connected to MongoDB", DB_NAME);
}

// Ensure DB is available before handling requests; protects routes from running with undefined db
app.use((req, res, next) => {
  if (!db) return res.status(503).send("Database not connected yet");
  next();
});

const lessonsCollection = () => db.collection("lessons");
const ordersCollection = () => db.collection("orders");

// GET all lessons (no filters)
app.get("/lessons", async (req, res, next) => {
  try {
    const items = await lessonsCollection().find({}).toArray();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// Search lessons by subject/location/description (partial) or by exact numeric price/spaces
app.get("/search", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).send("Missing search query 'q'");

    const isNumeric = !Number.isNaN(Number(q));
    let query;
    if (isNumeric) {
      const num = Number(q);
      query = { $or: [{ price: num }, { spaces: num }] };
    } else {
      const regex = { $regex: q, $options: "i" };
      query = {
        $or: [
          { subject: regex },
          { location: regex },
          { description: regex },
        ],
      };
    }

    const results = await lessonsCollection().find(query).toArray();
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Update spaces (generic PUT) increments/decrements by provided delta 
app.put("/lessons/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { spacesDelta } = req.body;
    const delta = Number(spacesDelta);
    if (Number.isNaN(delta)) {
      return res.status(400).send("spacesDelta must be a number");
    }
    const result = await lessonsCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { spaces: delta } },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).send("Lesson not found");
    res.json(result.value);
  } catch (err) {
    next(err);
  }
});

// Create order; minimal validation (requires items, name, phone) and stamps createdAt
app.post("/orders", async (req, res, next) => {
  try {
    const order = req.body;
    if (!order || !order.items || !order.name || !order.phone) {
      return res.status(400).send("Invalid order payload");
    }
    const inserted = await ordersCollection().insertOne({
      ...order,
      createdAt: new Date(),
    });
    res.json({ ok: true, orderId: inserted.insertedId });
  } catch (err) {
    next(err);
  }
});

// Fallback for missing images  
app.use("/images", (req, res) => {
  res.status(404).send("Image not found");
});

// Error handler    
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error");
});

// Connect to DB and start server
connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });


