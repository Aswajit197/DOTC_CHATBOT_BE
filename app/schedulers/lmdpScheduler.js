// ============================================
// SETUP: Install node-cron
// npm install node-cron
// ============================================

const cron = require("node-cron");
const axios = require("axios");
const Session = require("../model/session.model"); // Adjust path as needed

const API_BASE = process.env.API_BASE_URL;

// 🔹 AUTOMATED LMDP REFRESH - Runs every 24 hours
const startLmdpAutoRefresh = () => {
	// Run at 2 AM every day
	cron.schedule("0 2 * * *", async () => {
		console.log("\n========================================");
		console.log("🔄 STARTING AUTOMATED LMDP REFRESH");
		console.log(`Scheduled at: ${new Date().toLocaleString()}`);
		console.log("========================================");

		try {
			// 1️⃣ Find all unique ClientIds
			const uniqueClientIds = await Session.distinct("ClientId");
			console.log(`Found ${uniqueClientIds.length} unique ClientIds`);

			let successCount = 0;
			let errorCount = 0;

			// 2️⃣ Loop through each unique ClientId
			for (const clientId of uniqueClientIds) {
				try {
					console.log(`\n📍 Processing ClientId: ${clientId}`);

					// 3️⃣ Fetch fresh driver list from API
					const response = await axios.get(`${API_BASE}/GetDriverByClientId?ClientId=${clientId}`);

					if (!response?.data || !Array.isArray(response.data.data)) {
						console.error(`⚠️ Invalid response for ClientId: ${clientId}`);
						errorCount++;
						continue;
					}

					// 4️⃣ Format driver list
					const updatedDriverList = response.data.data.map((driver) => ({
						driverId: driver.driverId,
						driverName: driver.firstName + " " + driver.lastName,
					}));

					console.log(`✅ Fetched ${updatedDriverList.length} drivers`);

					// 5️⃣ Update ALL sessions with this ClientId
					const updateResult = await Session.updateMany(
						{ ClientId: clientId },
						{
							$set: {
								lmdpLists: updatedDriverList,
								updatedAt: new Date(),
							},
						}
					);

					console.log(`✅ Updated ${updateResult.modifiedCount} sessions for ClientId: ${clientId}`);
					successCount++;
				} catch (err) {
					console.error(`❌ Error processing ClientId ${clientId}:`, err.message);
					errorCount++;
				}
			}

			console.log("\n========================================");
			console.log("✅ AUTOMATED LMDP REFRESH COMPLETED");
			console.log(`Success: ${successCount}, Errors: ${errorCount}`);
			console.log("========================================\n");
		} catch (err) {
			console.error("❌ FATAL ERROR in automated LMDP refresh:", err);
		}
	});

	console.log("✅ LMDP Auto-refresh scheduler started (runs daily at 2 AM)");
};

// 🔹 AUTOMATED WEEK DAYS REFRESH - Runs every 24 hours
const startWeekDaysAutoRefresh = () => {
	// Run at 3 AM every day
	cron.schedule("0 2 * * *", async () => {
		console.log("\n========================================");
		console.log("🔄 STARTING AUTOMATED WEEK DAYS REFRESH");
		console.log(`Scheduled at: ${new Date().toLocaleString()}`);
		console.log("========================================");

		try {
			// 1️⃣ Find all unique ClientIds
			const uniqueClientIds = await Session.distinct("ClientId");
			console.log(`Found ${uniqueClientIds.length} unique ClientIds`);

			let successCount = 0;
			let errorCount = 0;

			// 2️⃣ Loop through each unique ClientId
			for (const clientId of uniqueClientIds) {
				try {
					console.log(`\n📍 Processing ClientId: ${clientId}`);

					// 3️⃣ Fetch week list from API
					const response = await axios.get(`${API_BASE}/GetWeekListForBackEnd?ClientId=${clientId}`);

					if (!response?.data || !Array.isArray(response.data.data.weeks) || response.data.data.weeks.length === 0) {
						console.error(`⚠️ Invalid response for ClientId: ${clientId}`);
						errorCount++;
						continue;
					}

					// 4️⃣ Get the last week object
					const lastWeek = response.data.data.weeks[response.data.data.weeks.length - 1];

					// 5️⃣ Extract dates and get day names
					const weekStartDate = new Date(lastWeek.client_WeekStarting);
					const weekEndDate = new Date(lastWeek.client_WeekEnding);

					const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
					const startDayName = dayNames[weekStartDate.getDay()];
					const endDayName = dayNames[weekEndDate.getDay()];

					console.log(`✅ Fetched week days - Start: ${startDayName}, End: ${endDayName}`);

					// 6️⃣ Update ALL sessions with this ClientId
					const updateResult = await Session.updateMany(
						{ ClientId: clientId },
						{
							$set: {
								clientWeekStartDay: startDayName,
								clientWeekEndDay: endDayName,
								updatedAt: new Date(),
							},
						}
					);

					console.log(`✅ Updated ${updateResult.modifiedCount} sessions for ClientId: ${clientId}`);
					successCount++;
				} catch (err) {
					console.error(`❌ Error processing ClientId ${clientId}:`, err.message);
					errorCount++;
				}
			}

			console.log("\n========================================");
			console.log("✅ AUTOMATED WEEK DAYS REFRESH COMPLETED");
			console.log(`Success: ${successCount}, Errors: ${errorCount}`);
			console.log("========================================\n");
		} catch (err) {
			console.error("❌ FATAL ERROR in automated week days refresh:", err);
		}
	});

	console.log("✅ Week Days Auto-refresh scheduler started (runs daily at 3 AM)");
};

// 🔹 ALTERNATIVE: Manual trigger with interval (if cron doesn't work)
const startLmdpAutoRefreshWithInterval = (intervalHours = 24) => {
	// const intervalMs = intervalHours * 60 * 60 * 1000;
	const intervalMs = 5 * 60 * 1000; //5 minute for testing

	setInterval(async () => {
		console.log("\n========================================");
		console.log("🔄 STARTING AUTOMATED LMDP REFRESH (Interval-based)");
		console.log(`Next refresh in ${intervalHours} hours`);
		console.log("========================================");

		try {
			const uniqueClientIds = await Session.distinct("ClientId");
			console.log(`Found ${uniqueClientIds.length} unique ClientIds`);

			let successCount = 0;
			let errorCount = 0;

			for (const clientId of uniqueClientIds) {
				try {
					console.log(`\n📍 Processing ClientId: ${clientId}`);
					console.log(`${API_BASE}/GetDriverByClientId?ClientId=${clientId}`);
					const response = await axios.get(`${API_BASE}/GetDriverByClientId?ClientId=${clientId}`);
					console.log(response);

					if (!response?.data || !Array.isArray(response.data.data)) {
						console.error(`⚠️ Invalid response for ClientId: ${clientId}`);
						errorCount++;
						continue;
					}

					const updatedDriverList = response.data.data.map((driver) => ({
						driverId: driver.driverId,
						driverName: driver.firstName + " " + driver.lastName,
					}));
					console.log(updatedDriverList);

					console.log(`✅ Fetched ${updatedDriverList.length} drivers`);

					const updateResult = await Session.updateMany(
						{ ClientId: clientId },
						{
							$set: {
								lmdpLists: updatedDriverList,
								updatedAt: new Date(),
							},
						}
					);

					console.log(`✅ Updated ${updateResult.modifiedCount} sessions for ClientId: ${clientId}`);
					successCount++;
				} catch (err) {
					console.error(`❌ Error processing ClientId ${clientId}:`, err.message);
					errorCount++;
				}
			}

			console.log("\n========================================");
			console.log("✅ AUTOMATED LMDP REFRESH COMPLETED");
			console.log(`Success: ${successCount}, Errors: ${errorCount}`);
			console.log("========================================\n");
		} catch (err) {
			console.error("❌ FATAL ERROR in automated refresh:", err);
		}
	}, intervalMs);

	console.log(`✅ LMDP Auto-refresh scheduler started (runs every ${intervalHours} hours)`);
};

// 🔹 ALTERNATIVE: Manual trigger with interval for week days (if cron doesn't work)
const startWeekDaysAutoRefreshWithInterval = (intervalHours = 24) => {
	// const intervalMs = intervalHours * 60 * 60 * 1000;
	const intervalMs = 2 * 60 * 1000; //5 minute for testing

	setInterval(async () => {
		console.log("\n========================================");
		console.log("🔄 STARTING AUTOMATED WEEK DAYS REFRESH (Interval-based)");
		console.log(`Next refresh in ${intervalHours} hours`);
		console.log("========================================");

		try {
			const uniqueClientIds = await Session.distinct("ClientId");
			console.log(`Found ${uniqueClientIds.length} unique ClientIds`);

			let successCount = 0;
			let errorCount = 0;

			for (const clientId of uniqueClientIds) {
				try {
					console.log(`\n📍 Processing ClientId: ${clientId}`);
					const response = await axios.get(`${API_BASE}/GetWeekListForBackEnd?ClientId=${clientId}`);

					if (!response?.data || !Array.isArray(response.data.data.weeks) || response.data.data.weeks.length === 0) {
						console.error(`⚠️ Invalid response for ClientId: ${clientId}`);
						errorCount++;
						continue;
					}

					const lastWeek = response.data.data.weeks[response.data.data.weeks.length - 1];
					const weekStartDate = new Date(lastWeek.client_WeekStarting);
					const weekEndDate = new Date(lastWeek.client_WeekEnding);

					console.log(weekStartDate.getDay());
					console.log(weekEndDate.getDay());

					const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
					const startDayName = dayNames[weekStartDate.getDay()];
					const endDayName = dayNames[weekEndDate.getDay()];

					console.log(`✅ Fetched week days - Start: ${startDayName}, End: ${endDayName}`);

					const updateResult = await Session.updateMany(
						{ ClientId: clientId },
						{
							$set: {
								clientWeekStartDay: startDayName,
								clientWeekEndDay: endDayName,
								updatedAt: new Date(),
							},
						}
					);

					console.log(`✅ Updated ${updateResult.modifiedCount} sessions for ClientId: ${clientId}`);
					successCount++;
				} catch (err) {
					console.error(`❌ Error processing ClientId ${clientId}:`, err.message);
					errorCount++;
				}
			}

			console.log("\n========================================");
			console.log("✅ AUTOMATED WEEK DAYS REFRESH COMPLETED");
			console.log(`Success: ${successCount}, Errors: ${errorCount}`);
			console.log("========================================\n");
		} catch (err) {
			console.error("❌ FATAL ERROR in automated week days refresh:", err);
		}
	}, intervalMs);

	console.log(`✅ Week Days Auto-refresh scheduler started (runs every ${intervalHours} hours)`);
};

// 🔹 Export all functions
module.exports = {
	startLmdpAutoRefresh, // LMDP cron-based refresh
	startWeekDaysAutoRefresh, // Week days cron-based refresh
	startLmdpAutoRefreshWithInterval, // LMDP interval-based refresh (fallback)
	startWeekDaysAutoRefreshWithInterval, // Week days interval-based refresh (fallback)
};
