const axios = require("axios");
const processIntentAndFormatResponse = require("./app/utils/ProcessIntentAndFormatResult");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const API_BASE = process.env.API_BASE_URL;

module.exports = [
	// 1. GetDriverWeeklyWorkingHrList
	{
		name: "GetDriverWeeklyWorkingHrList",
		description:
			"This API should be triggered whenever the user asks about a driver’s preferred weekly working hours. It provides the number of hours each driver wishes to work in a week along with their name. This is useful for managers to align schedules with driver availability and preferences. Use this API when the user asks questions such as: “How many hours does Alejandro Reyes want to work per week?”, “Show me all drivers with their weekly working hour preferences”, “Who prefers 40 hours per week?”, “List drivers with less than 35 weekly hours preference”, or “What is Anthony Semidey’s weekly working hour preference?",
		requiredFields: ["StationId"],
		exampleResponse: [
			{ driverName: "Alejandro Reyes", hours: 30 },
			{ driverName: "Hele Reyes", hours: 40 },
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.StationId) params.StationId = 2;
			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverWeeklyWorkingHrList?StationId=${params.StationId}`);

				const driversWeeklyWorkingHrList =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						hours: item?.hours,
					})) || [];

				// console.log(driversWeeklyWorkingHrList);

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDriverWeeklyWorkingHrList",
						description: "Returns a list of drivers with their total weekly working hours preference for the given station.",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{ driverName: "Alejandro Reyes", hours: 30 },
						{ driverName: "Hele Reyes", hours: 40 },
					],
					actualData: driversWeeklyWorkingHrList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.StationId) params.StationId = 2;
			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverWeeklyWorkingHrList?StationId=${params.StationId}`);

				const driversWeeklyWorkingHrList =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						hours: item?.hours,
					})) || [];

				// console.log(driversWeeklyWorkingHrList);

				return { data: driversWeeklyWorkingHrList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
				};
			}
		},
	},
	// 2. GetDayFactor
	{
		name: "GetDayFactor",
		description:
			"Returns priority factors for each day of the week including saturday and sunday .If a day is provided, returns only that day's data. Supports filtering by given asked day or multiple day",
		requiredFields: ["ClientId"],
		exampleResponse: [{ dayName: "Monday", factor: 2 }],
		handler: async (params, userMessage, session, onStream) => {
			// console.log(params,"params in get day factor handler")
			if (!params?.ClientId) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetDayFactor?ClientId=${params.ClientId}`);
				// console.log(data)
				const dayFactors =
					data?.data?.map((item) => ({
						id: item.id,
						dayName: item.dayName,
						factor: item.factor,
					})) || [];

				// console.log(dayFactors)

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDayFactor",
						description: "Returns priority factors for each day of the week.",
						isSuitableForGraph: true,
					},
					exampleResponse: [{ dayName: "Monday", factor: 2 }],
					actualData: dayFactors,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch day factor data.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			// console.log(params,"params in get day factor handler")
			if (!params?.ClientId) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetDayFactor?ClientId=${params.ClientId}`);
				// console.log(data)
				const dayFactors =
					data?.data?.map((item) => ({
						id: item.id,
						dayName: item.dayName,
						factor: item.factor,
					})) || [];

				// console.log(dayFactors)

				return { data: dayFactors };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch day factor data.",
				};
			}
		},
	},
	// 3. GetSchedulingShiftTypeList
	{
		name: "GetSchedulingShiftTypeList",
		description:
			"Returns available shift types and their details for scheduling , including minimum qualification (minQualification) and hours per shift ",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				shiftTitle: "Step Van",
				minQualification: 2,
				hoursPerShift: 10,
			},
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedulingShiftTypeList?ClientId=${params.ClientId}`);
				const shiftTypeList =
					data?.data?.map((item) => ({
						shiftTitle: item?.description,
						minQualification: item?.minQualification,
						hoursPerShift: item?.hoursPerShift,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedulingShiftTypeList",
						description: "Returns available shift types and their details for scheduling.",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{
							shiftTitle: "Step Van",
							minQualification: 2,
							hoursPerShift: 10,
						},
					],
					actualData: shiftTypeList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedulingShiftTypeList?ClientId=${params.ClientId}`);
				const shiftTypeList =
					data?.data?.map((item) => ({
						shiftTitle: item?.description,
						minQualification: item?.minQualification,
						hoursPerShift: item?.hoursPerShift,
					})) || [];

				return { data: shiftTypeList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
	},
	//4. GetLMDPDayPreferenceList
	{
		name: "GetLMDPDayPreferenceList",
		description:
			"This API is used to fetch a driver’s day-wise work preference, showing which days they prefer to work, avoid, or are neutral about. The preference field represents the main value to consider, while oldPreference can be ignored. Use this intent when the user wants to know a driver’s preferred working days or availability patterns. For example: “What is Anthony Semidey’s day preference?”, “Show me which days Alejandro Reyes prefers to work”, “List all drivers and their day preferences”, or “Which days does a driver not want to work?” This helps managers align schedules with driver availability and reduce conflicts.",
		requiredFields: ["DriverId", "ClientId"],
		exampleResponse: [
			{
				driverName: "JORGE VALENCIA",
				day: "Sun",
				preference: 2,
			},
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.DriverId) return { missingFields: ["DriverId"] };

			try {
				const { data } = await axios.get(
					`${API_BASE}/GetLMDPDayPreferenceList?DriverId=${params.DriverId}&ClientId=${params.ClientId}`
				);

				let DayPreferenceList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					day: item?.day,
					preference: item?.preference,
				}));

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedulingShiftTypeList",
						description:
							"This API is used to fetch a driver’s day-wise work preference, showing which days they prefer to work, avoid, or are neutral about. The preference field represents the main value to consider, while oldPreference can be ignored. Use this intent when the user wants to know a driver’s preferred working days or availability patterns. For example: “What is Anthony Semidey’s day preference?”, “Show me which days Alejandro Reyes prefers to work”, “List all drivers and their day preferences”, or “Which days does a driver not want to work?” This helps managers align schedules with driver availability and reduce conflicts.",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{
							driverName: "JORGE VALENCIA",
							day: "Sun",
							preference: 2,
						},
					],
					actualData: DayPreferenceList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.DriverId) return { missingFields: ["DriverId"] };

			try {
				const { data } = await axios.get(
					`${API_BASE}/GetLMDPDayPreferenceList?DriverId=${params.DriverId}&ClientId=${params.ClientId}`
				);

				let DayPreferenceList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					day: item?.day,
					preference: item?.preference,
				}));

				return { data: DayPreferenceList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
	},
	//5. GetDriverOTPreferenceList
	{
		name: "GetDriverOTPreferenceList",
		description:
			"Retrieves each driver's OT (Overtime Preference) settings for a given StationId. This does NOT include qualifications or weekly date ranges — only the preference values.",
		requiredFields: ["StationId"],
		exampleResponse: [{ driverName: "JORGE VALENCIA", preference: 2 }],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.StationId) params.StationId = 2;

			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetDriverOTPreferenceList?StationId=${params.StationId}`
				);

				// console.log(data);

				let DriversOTPPreferenceList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					preference: item?.preference,
				}));

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDriverOTPreferenceList",
						description: "Returns OTP preference for each drivers",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{
							driverName: "JORGE VALENCIA",
							preference: 2,
						},
					],
					actualData: DriversOTPPreferenceList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers OTP preference list",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.StationId) params.StationId = 2;

			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetDriverOTPreferenceList?StationId=${params.StationId}`
				);
				let DriversOTPPreferenceList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					preference: item?.preference,
				}));

				return { data: DriversOTPPreferenceList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers OTP preference list",
				};
			}
		},
	},
	//6. GetLMDPMaxQualificationsList
	{
		name: "GetLMDPMaxQualificationsList",
		description:
			"Retrieves the maximum qualification level of all drivers (also called LMDPs) for a specific ClientId within a specified weekly date range (FromDate to ToDate), based on a Sunday–Saturday week. This API should also be used when the user requests qualifications alongside other driver-related information (such as overtime preferences, shifts, or assignments), or when the query involves filtering drivers by qualification level (e.g., 'show drivers with qualification 3 and their OT preferences' or 'list all LMDPs above qualification 2'). It also supports queries for a single driver by name or for the full list of drivers.",
		requiredFields: ["ClientId", "FromDate", "ToDate"],
		exampleResponse: [{ driverName: "JORGE VALENCIA", qualification: 2 }],
		handler: async (params, userMessage, session, onStream) => {
			console.log(onStream, "on stream on GetLMDPMaxQualificationsList");
			// If FromDate/ToDate missing
			if (!params?.FromDate || !params?.ToDate) {
				const today = new Date();
				const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

				try {
					const prompt = `
You are a date extraction assistant.

Today's date is ${todayStr}.
If the user uses relative terms like "this week", "next Monday", or "yesterday", 
you MUST calculate based on today's date.

Rules:
- A week starts on SUNDAY and ends on SATURDAY.
- FromDate = the Sunday of the week containing the reference date.
- ToDate = the Saturday of the week containing the reference date.

Steps:
1. Identify the reference date (either explicit or relative to today).
2. Find the Sunday of that week (FromDate) and the Saturday of that week (ToDate).
3. Output both in strict YYYY/MM/DD format.

If no date is found, return null for both.

User message: "${userMessage}"

Respond in JSON only:
{
  "FromDate": "YYYY/MM/DD" or null,
  "ToDate": "YYYY/MM/DD" or null
}
`;

					const aiResp = await openai.chat.completions.create({
						model: "gpt-4o-mini",
						messages: [
							{ role: "system", content: "You are a helpful assistant for parsing dates." },
							{ role: "user", content: prompt },
						],
						temperature: 0,
					});

					const dateResult = JSON.parse(aiResp.choices[0].message.content || "{}");

					if (dateResult?.FromDate && dateResult?.ToDate) {
						params.FromDate = dateResult.FromDate;
						params.ToDate = dateResult.ToDate;
					} else {
						// 🛠 No date found → default to current week Sunday–Saturday
						const dayOfWeek = today.getDay(); // 0=Sunday
						const sunday = new Date(today);
						sunday.setDate(today.getDate() - dayOfWeek);
						const saturday = new Date(sunday);
						saturday.setDate(sunday.getDate() + 6);

						const fmt = (d) =>
							`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

						params.FromDate = fmt(sunday);
						params.ToDate = fmt(saturday);
					}
				} catch (err) {
					console.error("Date parsing failed:", err);

					// 🛠 On error → default to current week Sunday–Saturday
					const dayOfWeek = today.getDay();
					const sunday = new Date(today);
					sunday.setDate(today.getDate() - dayOfWeek);
					const saturday = new Date(sunday);
					saturday.setDate(sunday.getDate() + 6);

					const fmt = (d) =>
						`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

					params.FromDate = fmt(sunday);
					params.ToDate = fmt(saturday);
				}
			}

			// 3️⃣ Final param validation
			const missingFields = [];
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.FromDate) missingFields.push("FromDate");
			if (!params?.ToDate) missingFields.push("ToDate");

			if (missingFields.length) {
				return { missingFields };
			}

			// 4️⃣ API call
			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetLMDPMaxQualificationsList?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`
				);

				let DriversMaxQualificationList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					qualification: item?.qualification,
				}));

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetLMDPMaxQualificationsList",
						description:
							"Retrieves the qualifications of all drivers for a specific ClientId within a specified weekly date range (FromDate to ToDate). This is based on a Sunday–Saturday week.",
						isSuitableForGraph: true,
					},
					exampleResponse: [{ driverName: "JORGE VALENCIA", qualification: 2 }],
					actualData: DriversMaxQualificationList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers Drivers MaxQualification list",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			// If FromDate/ToDate missing
			if (!params?.FromDate || !params?.ToDate) {
				const today = new Date();
				const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

				try {
					const prompt = `
You are a date extraction assistant.

Today's date is ${todayStr}.
If the user uses relative terms like "this week", "next Monday", or "yesterday", 
you MUST calculate based on today's date.

Rules:
- A week starts on SUNDAY and ends on SATURDAY.
- FromDate = the Sunday of the week containing the reference date.
- ToDate = the Saturday of the week containing the reference date.

Steps:
1. Identify the reference date (either explicit or relative to today).
2. Find the Sunday of that week (FromDate) and the Saturday of that week (ToDate).
3. Output both in strict YYYY/MM/DD format.

If no date is found, return null for both.

User message: "${userMessage}"

Respond in JSON only:
{
  "FromDate": "YYYY/MM/DD" or null,
  "ToDate": "YYYY/MM/DD" or null
}
`;

					const aiResp = await openai.chat.completions.create({
						model: "gpt-4o-mini",
						messages: [
							{ role: "system", content: "You are a helpful assistant for parsing dates." },
							{ role: "user", content: prompt },
						],
						temperature: 0,
					});

					const dateResult = JSON.parse(aiResp.choices[0].message.content || "{}");

					if (dateResult?.FromDate && dateResult?.ToDate) {
						params.FromDate = dateResult.FromDate;
						params.ToDate = dateResult.ToDate;
					} else {
						// 🛠 No date found → default to current week Sunday–Saturday
						const dayOfWeek = today.getDay(); // 0=Sunday
						const sunday = new Date(today);
						sunday.setDate(today.getDate() - dayOfWeek);
						const saturday = new Date(sunday);
						saturday.setDate(sunday.getDate() + 6);

						const fmt = (d) =>
							`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

						params.FromDate = fmt(sunday);
						params.ToDate = fmt(saturday);
					}
				} catch (err) {
					console.error("Date parsing failed:", err);

					// 🛠 On error → default to current week Sunday–Saturday
					const dayOfWeek = today.getDay();
					const sunday = new Date(today);
					sunday.setDate(today.getDate() - dayOfWeek);
					const saturday = new Date(sunday);
					saturday.setDate(sunday.getDate() + 6);

					const fmt = (d) =>
						`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

					params.FromDate = fmt(sunday);
					params.ToDate = fmt(saturday);
				}
			}

			// 3️⃣ Final param validation
			const missingFields = [];
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.FromDate) missingFields.push("FromDate");
			if (!params?.ToDate) missingFields.push("ToDate");

			if (missingFields.length) {
				return { missingFields };
			}

			// 4️⃣ API call
			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetLMDPMaxQualificationsList?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`
				);

				let DriversMaxQualificationList = data?.data?.map((item) => ({
					driverName: item?.driverName,
					qualification: item?.qualification,
				}));

				return { data: DriversMaxQualificationList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers Drivers MaxQualification list",
				};
			}
		},
	},
	//7.GetBlobShiftDriverData
	{
		name: "GetBlobShiftDriverData",
		description:
			"Returns total hours scheduled (for each shift type) between weeks 25(start week number) and 33(end Week number) of all LMDPs broken down by shift type , list of drivers with their name and  shift type(like Parcel Van , Step Van , Walker ,Box Truck etc..) with hours like for a given range of week like 25 to 33",
		requiredFields: ["WeekStarting", "WeekEnding", "Year", "ClientId"],
		exampleResponse: [
			{
				driverName: "ALEJANDRO LAYA",
				shifts: {
					"Parcel Van": 0,
					"Step Van": 280,
					Walker: 32,
					"Box Truck": 0,
				},
			},
			{
				driverName: "Alejandro Reyes",
				shifts: {
					"Parcel Van": 0,
					"Step Van": 0,
					Walker: 128,
					"Box Truck": 0,
				},
			},
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;
			if (!params?.WeekStarting) return { missingFields: ["WeekStarting"] };
			if (!params?.WeekEnding) return { missingFields: ["WeekEnding"] };
			// Auto-fill current year if missing
			if (!params?.Year) {
				params.Year = new Date().getFullYear();
			}

			try {
				console.log(
					`${API_BASE}/GetBlobShiftDriverData?WeekStarting=${params?.WeekStarting}&WeekEnding=${params?.WeekEnding}&Year=${params?.Year}&ClientId=${params?.ClientId}`
				);
				const { data } = await axios.get(
					`${API_BASE}/GetBlobShiftDriverData?WeekStarting=${params?.WeekStarting}&WeekEnding=${params?.WeekEnding}&Year=${params?.Year}&ClientId=${params?.ClientId}`
				);

				const driversTotalScheduledHours =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						shifts: item?.shifts,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetBlobShiftDriverData",
						description:
							"Returns total hours scheduled (for each shift type) between weeks 25(start week number) and 33(end Week number) of all LMDPs broken down by shift type , list of drivers with their name and  shift type(like Parcel Van , Step Van , Walker ,Box Truck etc..) with hours like for a given range of week like 25 to 33",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{
							driverName: "ALEJANDRO LAYA",
							shifts: {
								"Parcel Van": 0,
								"Step Van": 280,
								Walker: 32,
								"Box Truck": 0,
							},
						},
						{
							driverName: "Alejandro Reyes",
							shifts: {
								"Parcel Van": 0,
								"Step Van": 0,
								Walker: 128,
								"Box Truck": 0,
							},
						},
					],
					actualData: driversTotalScheduledHours,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;
			if (!params?.WeekStarting) return { missingFields: ["WeekStarting"] };
			if (!params?.WeekEnding) return { missingFields: ["WeekEnding"] };
			// Auto-fill current year if missing
			if (!params?.Year) {
				params.Year = new Date().getFullYear();
			}

			try {
				console.log(
					`${API_BASE}/GetBlobShiftDriverData?WeekStarting=${params?.WeekStarting}&WeekEnding=${params?.WeekEnding}&Year=${params?.Year}&ClientId=${params?.ClientId}`
				);
				const { data } = await axios.get(
					`${API_BASE}/GetBlobShiftDriverData?WeekStarting=${params?.WeekStarting}&WeekEnding=${params?.WeekEnding}&Year=${params?.Year}&ClientId=${params?.ClientId}`
				);

				const driversTotalScheduledHours =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						shifts: item?.shifts,
					})) || [];

				return { data: driversTotalScheduledHours };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
				};
			}
		},
	},
	//8.GetTimeOffRequestForBackend
	{
		name: "GetTimeOffRequestForBackend",
		description:
			"Returns a list of driver's time-off requests, including details such as driver name, request dates, reason for leave, and the current status (approved, declined, or pending). This API helps track when drivers have requested time off and whether those requests were accepted or not. Example queries include: 'Which driver takes the most leaves?', 'Give me pending leave requests', 'Show me drivers time-off requests.",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				driverName: "ALEJANDRO LAYA",
				dateStart: "2025-03-05T00:00:00",
				dateEnd: "2025-02-10T00:00:00",
				requestReason: "request reason here",
				requestStatus: "Declined",
			},
		],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetTimeOffRequestForBackend?ClientId=${params?.ClientId}`);
				const driversOffRequestList =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						dateStart: item?.dateStart,
						dateEnd: item?.dateEnd,
						requestReason: item?.requestReason,
						requestStatus: item?.requestStatus,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetTimeOffRequestForBackend",
						description:
							"returns list of driver's time-off requests, including details such as driver name, request dates, reason for leave, and the current status (approved, declined, or pending). It is used to check when drivers have requested time off and whether those requests were accepted or not.",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							driverName: "ALEJANDRO LAYA",
							dateStart: "2025-03-05T00:00:00",
							dateEnd: "2025-02-10T00:00:00",
							requestReason: "request reason here",
							requestStatus: "Declined",
						},
					],
					actualData: driversOffRequestList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' time-off requests list.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetTimeOffRequestForBackend?ClientId=${params?.ClientId}`);
				const driversOffRequestList =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						dateStart: item?.dateStart,
						dateEnd: item?.dateEnd,
						requestReason: item?.requestReason,
						requestStatus: item?.requestStatus,
					})) || [];

				return { data: driversOffRequestList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' time-off requests list.",
				};
			}
		},
	},
	//9.GetLocationListForBackEnd
	{
		name: "GetLocationListForBackEnd",
		description:
			"returns a list of available locations for LMDPs/drivers along with their details, including name, address, city, state, zip code, type, and active status. It is used to identify and retrieve information about all operational locations in the system.",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				locationId: 163,
				locationName: "DBK1",
				locationAddress: "1 Bulova Ave",
				locationCity: "Woodside",
				locationZip: "11357",
				locationState: "New York",
			},
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetLocationListForBackEnd?ClientId=${params?.ClientId}`);

				const locationLists =
					data?.data?.map((item) => ({
						locationId: item?.locationId,
						locationName: item?.locationName,
						locationAddress: item?.locationAddress,
						locationCity: item?.locationCity,
						locationZip: item?.locationZip,
						locationState: item?.locationState,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetLocationListForBackEnd",
						description:
							"returns a list of available locations for LMDPs along with their details, including name, address, city, state, zip code, type, and active status. It is used to identify and retrieve information about all operational locations in the system.",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							locationId: 163,
							locationName: "DBK1",
							locationAddress: "1 Bulova Ave",
							locationCity: "Woodside",
							locationZip: "11357",
							locationState: "New York",
						},
					],
					actualData: locationLists,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch available locations for LMDPs.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetLocationListForBackEnd?ClientId=${params?.ClientId}`);

				const locationLists =
					data?.data?.map((item) => ({
						locationId: item?.locationId,
						locationName: item?.locationName,
						locationAddress: item?.locationAddress,
						locationCity: item?.locationCity,
						locationZip: item?.locationZip,
						locationState: item?.locationState,
					})) || [];

				return { data: locationLists };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch available locations for LMDPs.",
				};
			}
		},
	},
	//10.GetSchedAlignEngineLMDPPermissions
	{
		name: "GetSchedAlignEngineLMDPPermissions",
		description:
			"returns the default scheduling and permission settings defined by the manager. It includes rules such as the maximum allowed unavailable days, maximum time-off length, whether weekend availability is required, and permissions for approving neutral or open shift requests. This API is used to understand the scheduling policies and restrictions that apply to drivers.",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				maxDaysUnavailable: 2,
				requireWeekendDay: false,
				maxTimeOffLength: 2,
				approveNeutralRequests: true,
				requireOpenShiftApproval: false,
				canCreateLDMPGroups: false,
				chatResponsesVisible: false,
			},
		],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetLocationListForBackEnd?ClientId=${params?.ClientId}`);

				const permissionList =
					data?.data?.map((item) => ({
						maxDaysUnavailable: item?.maxDaysUnavailable,
						requireWeekendDay: item?.requireWeekendDay,
						maxTimeOffLength: item?.maxTimeOffLength,
						approveNeutralRequests: item?.approveNeutralRequests,
						canCreateLDMPGroups: item?.canCreateLDMPGroups,
						chatResponsesVisible: item?.chatResponsesVisible,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedAlignEngineLMDPPermissions",
						description:
							"returns the default scheduling and permission settings defined by the manager. It includes rules such as the maximum allowed unavailable days, maximum time-off length, whether weekend availability is required, and permissions for approving neutral or open shift requests. This API is used to understand the scheduling policies and restrictions that apply to drivers.",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							maxDaysUnavailable: 2,
							requireWeekendDay: false,
							maxTimeOffLength: 2,
							approveNeutralRequests: true,
							requireOpenShiftApproval: false,
							canCreateLDMPGroups: false,
							chatResponsesVisible: false,
						},
					],
					actualData: permissionList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch  default scheduling and permission settings.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetLocationListForBackEnd?ClientId=${params?.ClientId}`);

				const permissionList =
					data?.data?.map((item) => ({
						maxDaysUnavailable: item?.maxDaysUnavailable,
						requireWeekendDay: item?.requireWeekendDay,
						maxTimeOffLength: item?.maxTimeOffLength,
						approveNeutralRequests: item?.approveNeutralRequests,
						canCreateLDMPGroups: item?.canCreateLDMPGroups,
						chatResponsesVisible: item?.chatResponsesVisible,
					})) || [];

				return { data: permissionList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch  default scheduling and permission settings.",
				};
			}
		},
	},

	//11.GetDriverByClientId
	{
		name: "GetDriverByClientId",
		description:
			"Retrieves the complete list of all drivers associated with the client. Use this intent when the user asks for 'all drivers list', 'give me the driver list', 'list all LMDPs', 'show all drivers with their details', or 'driver directory'. It returns each driver's ID, first name, last name, mobile number, email, and unique identifier. Always output in table format for easy viewing",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				driverName: "Alejandaro Rayes",
				mobilePhone: 9178334663,
				email: "tincho76ny@gmail.com",
			},
		],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverByClientId?ClientId=${params?.ClientId}`);

				const driverList =
					data?.data?.map((item) => ({
						driverName: item.firstName + " " + item.lastName,
						mobilePhone: item.mobilePhone,
						email: item.email,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDriverByClientId",
						description:
							"retrieves the list of drivers associated with a client, including each driver’s ID, name, mobile number, email, and unique identifier. It is used to identify and access driver details linked to a specific client. Use when user asks for driver contact or ID details , return in table format",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							firstName: "Alejandro",
							lastName: "Rayes",
							mobilePhone: 9178334663,
							email: "tincho76ny@gmail.com",
						},
					],
					actualData: driverList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
		// new handler for multi-intent (raw data only)
		multiHandler: async (params) => {
			if (!params?.ClientId) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverByClientId?ClientId=${params?.ClientId}`);

				const driverList =
					data?.data?.map((item) => ({
						driverName: item.firstName + " " + item.lastName,
						mobilePhone: item.mobilePhone,
						email: item.email,
					})) || [];

				return { data: driverList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch driver list.",
				};
			}
		},
	},
	//12.GetSchedAlignEngineLMDPPreference
	{
		name: "GetSchedAlignEngineLMDPPreference",
		description:
			"returns the default driver preferences that are applied when a new driver is added but has not yet submitted their own preferences. It also provides weighted values indicating which preferences (day, standby, overtime, etc.) are more significant in scheduling decisions. Use this when the user asks about default or system-assigned preferences, such as “What are the default preferences for new drivers?”, “Which preferences are prioritized by default?”, or “How are standby and overtime preferences set if a driver has not submitted them?”",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				preferenceType: "StandBy",
				preferenceWeight: 20,
				preferenceDefault: 2,
			},
		],

		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedAlignEngineLMDPPreference?ClientId=${params?.ClientId}`);

				const driverPreferenceList =
					data?.data?.map((item) => ({
						preferenceType: item?.preferenceType,
						preferenceWeight: item?.preferenceWeight,
						preferenceDefault: item?.preferenceDefault,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedAlignEngineLMDPPreference",
						description:
							"returns the default driver preferences that are applied when a new driver is added but has not yet submitted their own preferences. It also provides weighted values indicating which preferences (day, standby, overtime, etc.) are more significant in scheduling decisions. Use this when the user asks about default or system-assigned preferences, such as “What are the default preferences for new drivers?”, “Which preferences are prioritized by default?”, or “How are standby and overtime preferences set if a driver has not submitted them?”",
						isSuitableForGraph: true,
					},
					exampleResponse: [
						{
							preferenceType: "StandBy",
							preferenceWeight: 20,
							preferenceDefault: 2,
						},
					],
					actualData: driverPreferenceList,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedAlignEngineLMDPPreference?ClientId=${params?.ClientId}`);

				const driverPreferenceList =
					data?.data?.map((item) => ({
						preferenceType: item?.preferenceType,
						preferenceWeight: item?.preferenceWeight,
						preferenceDefault: item?.preferenceDefault,
					})) || [];

				return { data: driverPreferenceList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
	},

	//13.GetSchedAlignEngineWeeklySetting
	{
		name: "GetSchedAlignEngineWeeklySetting",
		description:
			"provides the default weekly rules used by the scheduler when generating schedules, including maximum working hours, maximum consecutive days or hours allowed, standby shift limits, and tolerable or intolerable thresholds. Use this when the user asks about baseline scheduling rules, such as “What are the maximum weekly hours for drivers?”, “How many consecutive days can a driver work by default?”, or “What is the limit on standby shifts in a week?",
		requiredFields: ["ClientId"],
		exampleResponse: {
			maxHrs: 40,
			maxConsecutiveDaysWork: 5,
			maxConsecutiveHrsWork: 50,
			maxStandbyShifts: 1,
			tolerableThreshold: 15,
			intolerableThreshold: 20,
		},
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedAlignEngineWeeklySetting?ClientId=${params?.ClientId}`);

				const defaultRules =
					data?.data?.map((item) => ({
						maxHrs: item?.maxHrs,
						preferenceWeight: item?.preferenceWeight,
						maxConsecutiveDaysWork: item?.maxConsecutiveDaysWork,
						maxConsecutiveHrsWork: item?.maxConsecutiveHrsWork,
						maxStandbyShifts: item?.maxStandbyShifts,
						tolerableThreshold: item?.tolerableThreshold,
						intolerableThreshold: item?.intolerableThreshold,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedAlignEngineWeeklySetting",
						description:
							"provides the default weekly rules used by the scheduler when generating schedules, including maximum working hours, maximum consecutive days or hours allowed, standby shift limits, and tolerable or intolerable thresholds. Use this when the user asks about baseline scheduling rules, such as “What are the maximum weekly hours for drivers?”, “How many consecutive days can a driver work by default?”, or “What is the limit on standby shifts in a week?",
						isSuitableForGraph: false,
					},
					exampleResponse: {
						maxHrs: 40,
						maxConsecutiveDaysWork: 5,
						maxConsecutiveHrsWork: 50,
						maxStandbyShifts: 1,
						tolerableThreshold: 15,
						intolerableThreshold: 20,
					},
					actualData: defaultRules,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedAlignEngineWeeklySetting?ClientId=${params?.ClientId}`);

				const defaultRules =
					data?.data?.map((item) => ({
						maxHrs: item?.maxHrs,
						preferenceWeight: item?.preferenceWeight,
						maxConsecutiveDaysWork: item?.maxConsecutiveDaysWork,
						maxConsecutiveHrsWork: item?.maxConsecutiveHrsWork,
						maxStandbyShifts: item?.maxStandbyShifts,
						tolerableThreshold: item?.tolerableThreshold,
						intolerableThreshold: item?.intolerableThreshold,
					})) || [];

				return { data: defaultRules };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
	},

	//14.GetOperationListForBackEnd
	{
		name: "GetOperationListForBackEnd",
		description:
			"This API should be used whenever the user asks about the details of operations created by the manager. It provides a complete breakdown of an operation including whether it is active or inactive, the number and types of shifts (with their hours, qualifications, and colors), the locations assigned to the operation (with address and type), the wave times scheduled, and the arrival information such as reporting location and buffer time. Use this API when the user asks questions like: “What operations are currently active or inactive?”, “How many shifts are available in DBK1 Morning?”, “What shift types exist under an operation?”, “What locations are linked to a particular operation?”, “What wave times are scheduled for DBK1 Morning?”, or “Where should drivers report for this operation and how much time before shift?”.",
		requiredFields: ["ClientId", "FromDate", "ToDate"],
		exampleResponse: {
			shifts: [
				{
					shiftId: 240,
					description: "Parcel Van",
					minQualification: 0,
					hoursPerShift: 10,
					colorCode: "#3F00FF",
					fontColor: "#FFFFFF",
					pendOperShiftRequest: 0,
					operationShiftChangeId: 0,
					pendOperShiftWeekId: 0,
				},
				{
					shiftId: 241,
					description: "Step Van",
					minQualification: 0,
					hoursPerShift: 10,
					colorCode: "#0096FF",
					fontColor: "#FFFFFF",
					pendOperShiftRequest: 0,
					operationShiftChangeId: 0,
					pendOperShiftWeekId: 0,
				},
			],
			locations: [
				{
					locationId: 163,
					locationName: "DBK1",
					locationAddress: "1 Bulova Ave",
					locationType: 1,
					locationColorCode: "#A0522D",
					locationFontColor: "#FFFFFF",
				},
			],
			waveTimes: [
				{
					waveTimeId: 16,
					waveTime: "1900-01-01T06:45:00",
					pendOperRostRequest: 0,
					operationRostChangeId: 0,
					pendOperRostWeekId: 0,
				},
				{
					waveTimeId: 17,
					waveTime: "1900-01-01T07:15:00",
					pendOperRostRequest: 0,
					operationRostChangeId: 0,
					pendOperRostWeekId: 0,
				},
			],
			arrivalInfo: [
				{
					locationId: 164,
					locationName: "Offsite Lot",
					locationAddress: "3528 19th Ave",
					locationType: 2,
					locationColorCode: "#F4A460",
					locationFontColor: "#010101",
				},
			],
			arrivalTime: 30,
			operation: {
				operationId: 80,
				name: "DBK1 Morning",
				week: 304,
				colorId: 0,
				pendOperRequest: 0,
				operationChangeId: 0,
				pendOperWeekId: 0,
				pendOperDetRequest: 0,
				operationDetChangeId: 0,
				pendOperDetWeekId: 0,
			},
			active: 1,
		},
		handler: async (params, userMessage, session, onStream) => {
			// If FromDate/ToDate missing
			if (!params?.FromDate || !params?.ToDate) {
				const today = new Date();
				const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

				try {
					const prompt = `
You are a date extraction assistant.

Today's date is ${todayStr}.
If the user uses relative terms like "this week", "next Monday", or "yesterday", 
you MUST calculate based on today's date.

Rules:
- A week starts on SUNDAY and ends on SATURDAY.
- FromDate = the Sunday of the week containing the reference date.
- ToDate = the Saturday of the week containing the reference date.

Steps:
1. Identify the reference date (either explicit or relative to today).
2. Find the Sunday of that week (FromDate) and the Saturday of that week (ToDate).
3. Output both in strict YYYY/MM/DD format.

If no date is found, return null for both.

User message: "${userMessage}"

Respond in JSON only:
{
  "FromDate": "YYYY/MM/DD" or null,
  "ToDate": "YYYY/MM/DD" or null
}
`;

					const aiResp = await openai.chat.completions.create({
						model: "gpt-4o-mini",
						messages: [
							{ role: "system", content: "You are a helpful assistant for parsing dates." },
							{ role: "user", content: prompt },
						],
						temperature: 0,
					});

					const dateResult = JSON.parse(aiResp.choices[0].message.content || "{}");

					if (dateResult?.FromDate && dateResult?.ToDate) {
						params.FromDate = dateResult.FromDate;
						params.ToDate = dateResult.ToDate;
					} else {
						// 🛠 No date found → default to current week Sunday–Saturday
						const dayOfWeek = today.getDay(); // 0=Sunday
						const sunday = new Date(today);
						sunday.setDate(today.getDate() - dayOfWeek);
						const saturday = new Date(sunday);
						saturday.setDate(sunday.getDate() + 6);

						const fmt = (d) =>
							`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

						params.FromDate = fmt(sunday);
						params.ToDate = fmt(saturday);
					}
				} catch (err) {
					console.error("Date parsing failed:", err);

					// 🛠 On error → default to current week Sunday–Saturday
					const dayOfWeek = today.getDay();
					const sunday = new Date(today);
					sunday.setDate(today.getDate() - dayOfWeek);
					const saturday = new Date(sunday);
					saturday.setDate(sunday.getDate() + 6);

					const fmt = (d) =>
						`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

					params.FromDate = fmt(sunday);
					params.ToDate = fmt(saturday);
				}
			}

			// 3️⃣ Final param validation
			const missingFields = [];
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.FromDate) missingFields.push("FromDate");
			if (!params?.ToDate) missingFields.push("ToDate");

			if (missingFields.length) {
				return { missingFields };
			}

			try {
				const { data } = await axios.get(
					`${API_BASE}/GetOperationListForBackEnd?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`
				);

				const operationData =
					data?.data?.map((item) => ({
						shifts: item?.shifts,
						locations: item?.locations,
						waveTimes: item?.waveTimes,
						arrivalInfo: item?.arrivalInfo,
						arrivalTime: item?.arrivalTime,
						operation: item?.operation,
						active: item?.active,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetOperationListForBackEnd",
						description:
							"This API should be used whenever the user asks about the details of operations created by the manager. It provides a complete breakdown of an operation including whether it is active or inactive, the number and types of shifts (with their hours, qualifications, and colors), the locations assigned to the operation (with address and type), the wave times scheduled, and the arrival information such as reporting location and buffer time. Use this API when the user asks questions like: “What operations are currently active or inactive?”, “How many shifts are available in DBK1 Morning?”, “What shift types exist under an operation?”, “What locations are linked to a particular operation?”, “What wave times are scheduled for DBK1 Morning?”, or “Where should drivers report for this operation and how much time before shift?”.",
					},
					exampleResponse: {
						shifts: [
							{
								shiftId: 240,
								description: "Parcel Van",
								minQualification: 0,
								hoursPerShift: 10,
								colorCode: "#3F00FF",
								fontColor: "#FFFFFF",
								pendOperShiftRequest: 0,
								operationShiftChangeId: 0,
								pendOperShiftWeekId: 0,
							},
							{
								shiftId: 241,
								description: "Step Van",
								minQualification: 0,
								hoursPerShift: 10,
								colorCode: "#0096FF",
								fontColor: "#FFFFFF",
								pendOperShiftRequest: 0,
								operationShiftChangeId: 0,
								pendOperShiftWeekId: 0,
							},
						],
						locations: [
							{
								locationId: 163,
								locationName: "DBK1",
								locationAddress: "1 Bulova Ave",
								locationType: 1,
								locationColorCode: "#A0522D",
								locationFontColor: "#FFFFFF",
							},
						],
						waveTimes: [
							{
								waveTimeId: 16,
								waveTime: "1900-01-01T06:45:00",
								pendOperRostRequest: 0,
								operationRostChangeId: 0,
								pendOperRostWeekId: 0,
							},
							{
								waveTimeId: 17,
								waveTime: "1900-01-01T07:15:00",
								pendOperRostRequest: 0,
								operationRostChangeId: 0,
								pendOperRostWeekId: 0,
							},
						],
						arrivalInfo: [
							{
								locationId: 164,
								locationName: "Offsite Lot",
								locationAddress: "3528 19th Ave",
								locationType: 2,
								locationColorCode: "#F4A460",
								locationFontColor: "#010101",
							},
						],
						arrivalTime: 30,
						operation: {
							operationId: 80,
							name: "DBK1 Morning",
							week: 304,
							colorId: 0,
							pendOperRequest: 0,
							operationChangeId: 0,
							pendOperWeekId: 0,
							pendOperDetRequest: 0,
							operationDetChangeId: 0,
							pendOperDetWeekId: 0,
						},
						active: 1,
					},
					actualData: operationData,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			// If FromDate/ToDate missing
			if (!params?.FromDate || !params?.ToDate) {
				const today = new Date();
				const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

				try {
					const prompt = `
You are a date extraction assistant.

Today's date is ${todayStr}.
If the user uses relative terms like "this week", "next Monday", or "yesterday", 
you MUST calculate based on today's date.

Rules:
- A week starts on SUNDAY and ends on SATURDAY.
- FromDate = the Sunday of the week containing the reference date.
- ToDate = the Saturday of the week containing the reference date.

Steps:
1. Identify the reference date (either explicit or relative to today).
2. Find the Sunday of that week (FromDate) and the Saturday of that week (ToDate).
3. Output both in strict YYYY/MM/DD format.

If no date is found, return null for both.

User message: "${userMessage}"

Respond in JSON only:
{
  "FromDate": "YYYY/MM/DD" or null,
  "ToDate": "YYYY/MM/DD" or null
}
`;

					const aiResp = await openai.chat.completions.create({
						model: "gpt-4o-mini",
						messages: [
							{ role: "system", content: "You are a helpful assistant for parsing dates." },
							{ role: "user", content: prompt },
						],
						temperature: 0,
					});

					const dateResult = JSON.parse(aiResp.choices[0].message.content || "{}");

					if (dateResult?.FromDate && dateResult?.ToDate) {
						params.FromDate = dateResult.FromDate;
						params.ToDate = dateResult.ToDate;
					} else {
						// 🛠 No date found → default to current week Sunday–Saturday
						const dayOfWeek = today.getDay(); // 0=Sunday
						const sunday = new Date(today);
						sunday.setDate(today.getDate() - dayOfWeek);
						const saturday = new Date(sunday);
						saturday.setDate(sunday.getDate() + 6);

						const fmt = (d) =>
							`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

						params.FromDate = fmt(sunday);
						params.ToDate = fmt(saturday);
					}
				} catch (err) {
					console.error("Date parsing failed:", err);

					// 🛠 On error → default to current week Sunday–Saturday
					const dayOfWeek = today.getDay();
					const sunday = new Date(today);
					sunday.setDate(today.getDate() - dayOfWeek);
					const saturday = new Date(sunday);
					saturday.setDate(sunday.getDate() + 6);

					const fmt = (d) =>
						`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

					params.FromDate = fmt(sunday);
					params.ToDate = fmt(saturday);
				}
			}

			// 3️⃣ Final param validation
			const missingFields = [];
			if (!params?.ClientId) params.ClientId = 2;
			if (!params?.FromDate) missingFields.push("FromDate");
			if (!params?.ToDate) missingFields.push("ToDate");

			if (missingFields.length) {
				return { missingFields };
			}

			try {
				const { data } = await axios.get(
					`${API_BASE}/GetOperationListForBackEnd?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`
				);

				const operationData =
					data?.data?.map((item) => ({
						shifts: item?.shifts,
						locations: item?.locations,
						waveTimes: item?.waveTimes,
						arrivalInfo: item?.arrivalInfo,
						arrivalTime: item?.arrivalTime,
						operation: item?.operation,
						active: item?.active,
					})) || [];

				return { data: operationData };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of drivers associated with a client.",
				};
			}
		},
	},

	//15.GetOpenShiftForBackEnd
	{
		name: "GetOpenShiftForBackEnd",
		description:
			"This API should be used whenever the user asks about open shift requests that the manager has assigned to drivers outside their regular schedules. It provides details such as the driver name and ID, the shift type and duration, the delivery date, whether the driver has accepted the request, and related operational details like arrival time, arrival location, wave time, and loadout location. Use this API when the user asks questions like: “Which drivers have been requested to work additional shifts?”, “Has driver 5130 accepted the open shift?”, “Show me all open shift requests for a particular driver or date”, “What extra shifts are currently pending or accepted?”, or “Tell me the details of the additional Step Van shift assigned to a driver.”",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				driverName: "JUSTIN VELICELA",
				openShiftId: 27,
				driverId: 5130,
				shiftType: 241,
				duration: 10,
				shiftName: "Step Van",
				shiftTypeColor: "#0096FF",
				shiftTypeFontColor: "#FFFFFF",
				deliveryDate: "2025-07-27T00:00:00",
				isAccept: 1,
				arrivalTime: "TBD",
				arrivalLocationName: "TBD",
				arrivalLatitude: "TBD",
				arrivalLongitude: "TBD",
				waveTime: "TBD",
				loadoutLocationName: "TBD",
				loadoutLatitude: "TBD",
				loadoutLongitude: "TBD",
				expiration: "0001-01-01T00:00:00",
			},
		],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetOpenShiftForBackEnd?ClientId=${params?.ClientId}`);

				const openShiftData =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						openShiftId: item?.openShiftId,
						driverId: item?.driverId,
						shiftType: item?.shiftType,
						duration: item?.duration,
						shiftName: item?.shiftName,
						shiftTypeColor: item?.shiftTypeColor,
						shiftTypeFontColor: item?.shiftTypeFontColor,
						deliveryDate: item?.deliveryDate,
						isAccept: item?.isAccept,
						arrivalTime: item?.arrivalTime,
						arrivalLocationName: item?.arrivalLocationName,
						arrivalLatitude: item?.arrivalLatitude,
						arrivalLongitude: item?.arrivalLongitude,
						waveTime: item?.waveTime,
						loadoutLocationName: item?.loadoutLocationName,
						loadoutLatitude: item?.loadoutLatitude,
						loadoutLongitude: item?.loadoutLongitude,
						expiration: item?.expiration,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetOpenShiftForBackEnd",
						description:
							"This API should be used whenever the user asks about open shift requests that the manager has assigned to drivers outside their regular schedules. It provides details such as the driver name and ID, the shift type and duration, the delivery date, whether the driver has accepted the request, and related operational details like arrival time, arrival location, wave time, and loadout location. Use this API when the user asks questions like: “Which drivers have been requested to work additional shifts?”, “Has driver 5130 accepted the open shift?”, “Show me all open shift requests for a particular driver or date”, “What extra shifts are currently pending or accepted?”, or “Tell me the details of the additional Step Van shift assigned to a driver.”",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							driverName: "JUSTIN VELICELA",
							openShiftId: 27,
							driverId: 5130,
							shiftType: 241,
							duration: 10,
							shiftName: "Step Van",
							shiftTypeColor: "#0096FF",
							shiftTypeFontColor: "#FFFFFF",
							deliveryDate: "2025-07-27T00:00:00",
							isAccept: 1,
							arrivalTime: "TBD",
							arrivalLocationName: "TBD",
							arrivalLatitude: "TBD",
							arrivalLongitude: "TBD",
							waveTime: "TBD",
							loadoutLocationName: "TBD",
							loadoutLatitude: "TBD",
							loadoutLongitude: "TBD",
							expiration: "0001-01-01T00:00:00",
						},
					],
					actualData: openShiftData,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list for open shifts.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetOpenShiftForBackEnd?ClientId=${params?.ClientId}`);

				const openShiftData =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						openShiftId: item?.openShiftId,
						driverId: item?.driverId,
						shiftType: item?.shiftType,
						duration: item?.duration,
						shiftName: item?.shiftName,
						shiftTypeColor: item?.shiftTypeColor,
						shiftTypeFontColor: item?.shiftTypeFontColor,
						deliveryDate: item?.deliveryDate,
						isAccept: item?.isAccept,
						arrivalTime: item?.arrivalTime,
						arrivalLocationName: item?.arrivalLocationName,
						arrivalLatitude: item?.arrivalLatitude,
						arrivalLongitude: item?.arrivalLongitude,
						waveTime: item?.waveTime,
						loadoutLocationName: item?.loadoutLocationName,
						loadoutLatitude: item?.loadoutLatitude,
						loadoutLongitude: item?.loadoutLongitude,
						expiration: item?.expiration,
					})) || [];

				return { data: openShiftData };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list for open shifts.",
				};
			}
		},
	},

	//16.GetAllPreferenceHistoryForBackEnd
	{
		name: "GetAllPreferenceHistoryForBackEnd",
		description:
			"This API should be used whenever the user asks about the history of driver preference changes, specifically which drivers modified their preferences, what type of preference was changed (e.g., day, shift, standby, OT), the old value, the new value, and the date of the change. It only returns approved preference change history. Use this API when the user asks questions like: “Which drivers have recently updated their day preferences?”, “Show me the preference change history for Alejandro Reyes”, “What was the old and new value when a driver changed their shift preference?”, “List all approved preference changes from last week”, or “Has anyone changed their OT or standby preference recently?”",
		requiredFields: ["ClientId"],
		exampleResponse: [
			{
				driverName: "Alejandro Reyes",
				preferenceType: "Day",
				preferenceDescription: "Wed",
				oldValue: 0,
				newValue: 0,
				requestStatus: "Approved",
				updateDate: "2025-08-27T06:08:24.173",
				expiration: "2025-09-03T06:08:24.173",
			},
		],
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetAllPreferenceHistoryForBackEnd?ClientId=${params?.ClientId}`);

				const preferenceHistory =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						preferenceType: item?.preferenceType,
						preferenceDescription: item?.preferenceDescription,
						oldValue: item?.oldValue,
						newValue: item?.newValue,
						requestStatus: item?.requestStatus,
						updateDate: item?.updateDate,
						expiration: item?.expiration,
					})) || [];

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetAllPreferenceHistoryForBackEnd",
						description:
							"This API should be used whenever the user asks about the history of driver preference changes, specifically which drivers modified their preferences, what type of preference was changed (e.g., day, shift, standby, OT), the old value, the new value, and the date of the change. It only returns approved preference change history. Use this API when the user asks questions like: “Which drivers have recently updated their day preferences?”, “Show me the preference change history for Alejandro Reyes”, “What was the old and new value when a driver changed their shift preference?”, “List all approved preference changes from last week”, or “Has anyone changed their OT or standby preference recently?”",
						isSuitableForGraph: false,
					},
					exampleResponse: [
						{
							driverName: "Alejandro Reyes",
							preferenceType: "Day",
							preferenceDescription: "Wed",
							oldValue: 0,
							newValue: 0,
							requestStatus: "Approved",
							updateDate: "2025-08-27T06:08:24.173",
							expiration: "2025-09-03T06:08:24.173",
						},
					],
					actualData: preferenceHistory,
					params,
					session,
					onStream,
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of preference history drivers.",
				};
			}
		},
		multiHandler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetAllPreferenceHistoryForBackEnd?ClientId=${params?.ClientId}`);

				const preferenceHistory =
					data?.data?.map((item) => ({
						driverName: item?.driverName,
						preferenceType: item?.preferenceType,
						preferenceDescription: item?.preferenceDescription,
						oldValue: item?.oldValue,
						newValue: item?.newValue,
						requestStatus: item?.requestStatus,
						updateDate: item?.updateDate,
						expiration: item?.expiration,
					})) || [];

				return { data: preferenceHistory };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch list of preference history drivers.",
				};
			}
		},
	},
];
