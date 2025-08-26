const axios = require("axios");
const processIntentAndFormatResponse = require("./app/utils/ProcessIntentAndFormatResult");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const API_BASE = process.env.API_BASE_URL;

module.exports = [
	// 1. GetDriverWeeklyWorkingHrList
	{
		name: "GetDriverWeeklyWorkingHrList",
		description: "Returns a list of drivers with their total weekly working hours for the given station.",
		requiredFields: ["StationId"],
		exampleResponse: {
			driversWeeklyWorkingHrList: [
				{ driverName: "Alejandro Reyes", hours: 30 },
				{ driverName: "Hele Reyes", hours: 40 },
			],
		},
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
					exampleResponse: {
						driversWeeklyWorkingHrList: [
							{ driverName: "Alejandro Reyes", hours: 30 },
							{ driverName: "Hele Reyes", hours: 40 },
						],
					},
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
	},

	// 2. GetDayFactor
	{
		name: "GetDayFactor",
		description:
			"Returns priority factors for each day of the week.  If a day is provided, returns only that day's data. Supports filtering by given asked day or multiple day",
		requiredFields: ["ClientId"],
		optionalFields: ["dayName"],
		exampleResponse: {
			dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
		},
		handler: async (params, userMessage, session, onStream) => {
			// console.log(params,"params in getdayfactor handler")
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
					exampleResponse: {
						dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
					},
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
	},

	// 3. GetSchedulingShiftTypeList
	{
		name: "GetSchedulingShiftTypeList",
		description:
			"Returns available shift types and their details for scheduling , including minimum qualification (minQualification) and hours per shift ",
		requiredFields: ["ClientId"],
		exampleResponse: {
			shiftTypeList: [
				{
					shiftTitle: "Step Van",
					minQualification: 2,
					hoursPerShift: 10,
				},
			],
		},
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
					exampleResponse: {
						shiftTypeList: [
							{
								shiftTitle: "Step Van",
								minQualification: 2,
								hoursPerShift: 10,
							},
						],
					},
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
	},

	//4. GetLMDPDayPreferenceList
	{
		name: "GetLMDPDayPreferenceList",
		description:
			"Fetches driver's day preference list for each weak days , If a day is provided, returns only that day's data. Supports filtering by given asked day or multiple day",
		requiredFields: ["DriverId", "ClientId"],
		exampleResponse: {
			DayPreferenceList: [
				{
					driverName: "JORGE VALENCIA",
					day: "Sun",
					preference: 2,
				},
			],
		},
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
						description: "Returns available shift types and their details for scheduling.",
						isSuitableForGraph: true,
					},
					exampleResponse: {
						DayPreferenceList: [
							{
								driverName: "JORGE VALENCIA",
								day: "Sun",
								preference: 2,
							},
						],
					},
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
	},

	//5. GetDriverOTPreferenceList
	{
		name: "GetDriverOTPreferenceList",
		description:
			"Retrieves each driver's OT (Overtime Preference) settings for a given StationId. This does NOT include qualifications or weekly date ranges — only the preference values.",
		requiredFields: ["StationId"],
		exampleResponse: {
			DriversOTPPreferenceList: [{ driverName: "JORGE VALENCIA", preference: 2 }],
		},
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
					exampleResponse: {
						DriversOTPPreferenceList: [
							{
								driverName: "JORGE VALENCIA",
								preference: 2,
							},
						],
					},
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
	},
	//6. GetLMDPMaxQualificationsList
	{
		name: "GetLMDPMaxQualificationsList",
		description:
			"Retrieves the qualifications of all drivers for a specific ClientId within a specified weekly date range (FromDate to ToDate). This is based on a Sunday–Saturday week.",
		requiredFields: ["ClientId", "FromDate", "ToDate"],
		exampleResponse: {
			DriversMaxQualificationList: [{ driverName: "JORGE VALENCIA", qualification: 2 }],
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

			// console.log(params);
			// console.log(
			// 	`https://dotc-delivery.azurewebsites.net/GetLMDPMaxQualificationsList?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`
			// );

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
						name: "DriversMaxQualificationList",
						description: "Returns drivers(LMDP) qualification lists",
					},
					exampleResponse: {
						DriversMaxQualificationList: [
							{
								driverName: "JORGE VALENCIA",
								qualification: 2,
							},
						],
					},
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
	},

	//7.GetBlobShiftDriverData
	{
		name: "GetBlobShiftDriverData",
		description:
			"Returns total hours scheduled (for each shift type) between weeks 25(start week number) and 33(end Week number) of all LMDPs broken down by shift type , list of drivers with their name and  shift type(like Parcel Van , Step Van , Walker ,Box Truck etc..) with hours like for a given range of week like 25 to 33",
		requiredFields: ["WeekStarting", "WeekEnding", "Year", "ClientId"],
		exampleResponse: {
			driversWeeklyWorkingHrList: [
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
		},
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;
			if (!params?.WeekStarting) return { missingFields: ["WeekStarting"] };
			if (!params?.WeekEnding) return { missingFields: ["WeekEnding"] };
			// Auto-fill current year if missing
			if (!params?.Year) {
				params.Year = new Date().getFullYear();
			}

			try {
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
					exampleResponse: {
						driversTotalScheduledHours: [
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
					},
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
	},
	//8.GetTimeOffRequestForBackend
	{
		name: "GetTimeOffRequestForBackend",
		description:
			"returns list of driver's time-off requests, including details such as driver name, request dates, reason for leave, and the current status (approved, declined, or pending). It is used to check when drivers have requested time off and whether those requests were accepted or not.",
		requiredFields: ["ClientId"],
		exampleResponse: {
			driversOffRequestList: [
				{
					driverName: "ALEJANDRO LAYA",
					dateStart: "2025-03-05T00:00:00",
					dateEnd: "2025-02-10T00:00:00",
					requestReason: "request reason here",
					requestStatus: "Declined",
				},
			],
		},
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
					exampleResponse: {
						driversOffRequestList: [
							{
								driverName: "ALEJANDRO LAYA",
								dateStart: "2025-03-05T00:00:00",
								dateEnd: "2025-02-10T00:00:00",
								requestReason: "request reason here",
								requestStatus: "Declined",
							},
						],
					},
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
	},
	//9.GetLocationListForBackEnd
	{
		name: "GetLocationListForBackEnd",
		description:
			"returns a list of available locations for LMDPs along with their details, including name, address, city, state, zip code, type, and active status. It is used to identify and retrieve information about all operational locations in the system.",
		requiredFields: ["ClientId"],
		exampleResponse: {
			locationLists: [
				{
					locationId: 163,
					locationName: "DBK1",
					locationAddress: "1 Bulova Ave",
					locationCity: "Woodside",
					locationZip: "11357",
					locationState: "New York",
				},
			],
		},
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
					exampleResponse: {
						locationLists: [
							{
								locationId: 163,
								locationName: "DBK1",
								locationAddress: "1 Bulova Ave",
								locationCity: "Woodside",
								locationZip: "11357",
								locationState: "New York",
							},
						],
					},
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
	},
	//10.GetSchedAlignEngineLMDPPermissions
	{
		name: "GetSchedAlignEngineLMDPPermissions",
		description:
			"returns the default scheduling and permission settings defined by the manager. It includes rules such as the maximum allowed unavailable days, maximum time-off length, whether weekend availability is required, and permissions for approving neutral or open shift requests. This API is used to understand the scheduling policies and restrictions that apply to drivers.",
		requiredFields: ["ClientId"],
		exampleResponse: {
			permissionList: [
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
		},
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
					exampleResponse: {
						permissionList: [
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
					},
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
	},

	//11.GetDriverByClientId
	{
		name: "GetDriverByClientId",
		description:
			"retrieves the list of drivers associated with a client, including each driver’s ID, name, mobile number, email, and unique identifier. It is used to identify and access driver details linked to a specific client. Use when user asks for driver contact or ID details , return in table format",
		requiredFields: ["ClientId"],
		exampleResponse: {
			driverList: [
				{
					firstName: "Alejandro",
					lastName: "Rayes",
					mobilePhone: 9178334663,
					email: "tincho76ny@gmail.com",
				},
			],
		},
		handler: async (params, userMessage, session, onStream) => {
			if (!params?.ClientId !== 2) params.ClientId = 2;

			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverByClientId?ClientId=${params?.ClientId}`);

				const driverList =
					data?.data?.map((item) => ({
						firstName: item.firstName,
						lastName: item.lastName,
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
					exampleResponse: {
						driverList: [
							{
								firstName: "Alejandro",
								lastName: "Rayes",
								mobilePhone: 9178334663,
								email: "tincho76ny@gmail.com",
							},
						],
					},
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
						isSuitableForGraph:false
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
	},
];
