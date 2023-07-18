const fs = require("fs");
const path = require("path");

const archiveFilePath = path.join(__dirname, "archive.json");

// Function to load archive data from disk
const loadArchiveData = () => {
  try {
    const data = fs.readFileSync(archiveFilePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // Return an empty array if the file doesn't exist or there's an error
    return [];
  }
};

// Function to save archive data to disk
const saveArchiveData = (data) => {
  try {
    fs.writeFileSync(archiveFilePath, JSON.stringify(data), "utf8");
  } catch (error) {
    console.error("Error saving archive data:", error);
  }
};

module.exports = {
  loadArchiveData,
  saveArchiveData,
};
