const axios = require("axios");
const getResponseAccordingToUserIntent = require("./app/utils/getResponseAccordingToUserIntent ");

const API_BASE = process.env.API_BASE_URL;

module.exports = [
	// 1. GetDriverWeeklyWorkingHrList
	{
		name: "GetDriverWeeklyWorkingHrList",
		description: "Returns a list of drivers with their total weekly working hours preference for the given station.",
		requiredFields: ["StationId"],
		exampleResponse: {
			driversWeeklyWorkingHrList: [
				{ driverID: 1482, hours: 30 },
				{ driverID: 5527, hours: 40 },
			],
		},
		handler: async (params, userMessage) => {
			if (!params?.StationId) return { missingFields: ["StationId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverWeeklyWorkingHrList?StationId=${params.StationId}`);
				const driverList =
					data?.data?.map((item) => ({
						driverID: item?.driverId,
						hours: item?.hours,
					})) || [];

				const finalResponse = await getResponseAccordingToUserIntent({
					userMessage,
					exampleResponse: {
						driversWeeklyWorkingHrList: [
							{ driverID: 1482, hours: 30 },
							{ driverID: 5527, hours: 40 },
						],
					},
					actualData: { driversWeeklyWorkingHrList: driverList },
				});

				return finalResponse;
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
		description: "Returns priority factors for each day of the week.",
		requiredFields: ["ClientId"],
		optionalFields: ["dayName"],
		exampleResponse: {
			dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
		},
		handler: async (params, userMessage) => {
			if (!params?.ClientId) return { missingFields: ["ClientId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetDayFactor?ClientId=${params.ClientId}`);
				const dayFactors =
					data?.data?.map((item) => ({
						id: item.id,
						dayName: item.dayName,
						factor: item.factor,
					})) || [];

				const finalResponse = await getResponseAccordingToUserIntent({
					userMessage,
					exampleResponse: {
						dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
					},
					actualData: { dayFactors },
				});

				return finalResponse;
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
		description: "Returns available shift types and their details for scheduling.",
		requiredFields: ["ClientId"],
		exampleResponse: {
			shiftTypeList: [
				{
					shiftTitle: "Step Van",
					shiftId: 241,
					minQualification: 2,
					hoursPerShift: 10,
				},
			],
		},
		handler: async (params, userMessage) => {
			if (!params?.ClientId) return { missingFields: ["ClientId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedulingShiftTypeList?ClientId=${params.ClientId}`);
				const shiftTypeList =
					data?.data?.map((item) => ({
						shiftTitle: item?.description,
						shiftId: item?.shiftId,
						minQualification: item?.minQualification,
						hoursPerShift: item?.hoursPerShift,
					})) || [];

				const finalResponse = await getResponseAccordingToUserIntent({
					userMessage,
					exampleResponse: {
						shiftTypeList: [
							{
								shiftTitle: "Step Van",
								shiftId: 241,
								minQualification: 2,
								hoursPerShift: 10,
							},
						],
					},
					actualData: { shiftTypeList },
				});

				return finalResponse;
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
	},
];

//GetLMDPDayPreferenceList
// {
// 	name: "GetLMDPDayPreferenceList",
// 	description:
// 		"Fetches driver's preference list for each weak days ,If a day is provided, returns only that day's preference. Supports filtering by oldPreference and preference",
// 	requiredFields: ["DriverId", "ClientId"],
// 	optionalFields: ["preference", "onlyField", "oldPreference"],
// 	exampleResponse: {
// 		DayPreferenceList: [
// 			{
// 				driverId: 4536,
// 				day: "Sun",
// 				oldPreference: 0,
// 				preference: 2,
// 				deliveryDate: "0001-01-01T00:00:00",
// 			},
// 		],
// 	},
// 	handler: async (params) => {
// 		if (!params?.DriverId) return { missingFields: ["DriverId"] };
// 		if (!params?.ClientId) return { missingFields: ["ClientId"] };

// 		try {
// 			const { data } = await axios.get(
// 				`${API_BASE}/GetLMDPDayPreferenceList?DriverId=${params.ClientId}&ClientId=${params.DriverId}`
// 			);
// 			let DayPreferenceList = data?.data?.map((item) => ({
// 				driverId: item?.driverId,
// 				day: item?.day,
// 				oldPreference: item?.oldPreference,
// 				preference: item?.preference,
// 				deliveryDate: item?.deliveryDate,
// 			}));

// 			if (params?.shiftTitle) {
// 				const shiftTitleLower = params.shiftTitle.toLowerCase();
// 				shiftTypeList = shiftTypeList.filter((shift) => shift.shiftTitle?.toLowerCase() === shiftTitleLower);
// 			}

// 			if (params?.onlyField) {
// 				const validFields = ["minQualification", "hoursPerShift"];
// 				if (!validFields.includes(params.onlyField)) {
// 					return { error: true, message: `Invalid onlyField. Allowed: ${validFields.join(", ")}` };
// 				}

// 				// Support 'max' or 'min' filter
// 				if (params?.filter === "max") {
// 					const maxVal = Math.max(...shiftTypeList.map((s) => s[params.onlyField]));
// 					shiftTypeList = shiftTypeList.filter((s) => s[params.onlyField] === maxVal);
// 				} else if (params?.filter === "min") {
// 					const minVal = Math.min(...shiftTypeList.map((s) => s[params.onlyField]));
// 					shiftTypeList = shiftTypeList.filter((s) => s[params.onlyField] === minVal);
// 				}

// 				// Return shiftTitle + requested field
// 				shiftTypeList = shiftTypeList.map((shift) => ({
// 					shiftTitle: shift.shiftTitle,
// 					[params.onlyField]: shift[params.onlyField],
// 				}));
// 			}

// 			return { shiftTypeList };
// 		} catch (err) {
// 			return {
// 				error: true,
// 				message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
// 			};
// 		}
// 	},
// },
