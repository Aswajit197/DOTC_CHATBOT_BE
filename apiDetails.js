const axios = require("axios");
const processIntentAndFormatResponse = require("./app/utils/ProcessIntentAndFormatResult");

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

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDriverWeeklyWorkingHrList",
						description: "Returns a list of drivers with their total weekly working hours preference for the given station.",
					},
					exampleResponse: {
						driversWeeklyWorkingHrList: [
							{ driverID: 1482, hours: 30 },
							{ driverID: 5527, hours: 40 },
						],
					},
					actualData: { driversWeeklyWorkingHrList: driverList },
					params,
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

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDayFactor",
						description: "Returns priority factors for each day of the week.",
					},
					exampleResponse: {
						dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
					},
					actualData: { dayFactors },
					params,
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

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedulingShiftTypeList",
						description: "Returns available shift types and their details for scheduling.",
					},
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
			"Fetches driver's (LMDP) day preference list for each weak days ,If a day is provided, returns only that day's data. Supports filtering by given asked day or multiple day",
		requiredFields: ["DriverId", "ClientId"],
		exampleResponse: {
			DayPreferenceList: [
				{
					DriverId: 4536,
					day: "Sun",
					preference: 2,
				},
			],
		},
		handler: async (params, userMessage) => {
			if (!params?.DriverId) return { missingFields: ["DriverId"] };
			if (!params?.ClientId) return { missingFields: ["ClientId"] };

			try {
				const { data } = await axios.get(
					`${API_BASE}/GetLMDPDayPreferenceList?DriverId=${params.DriverId}&ClientId=${params.ClientId}`
				);

				console.log(data, "response Data");
				let DayPreferenceList = data?.data?.map((item) => ({
					DriverId: item?.driverId,
					day: item?.day,
					preference: item?.preference,
				}));

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetSchedulingShiftTypeList",
						description: "Returns available shift types and their details for scheduling.",
					},
					exampleResponse: {
						DayPreferenceList: [
							{
								DriverId: 4536,
								day: "Sun",
								preference: 2,
							},
						],
					},
					actualData: { DayPreferenceList },
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
		description: "Returns OTP preference for each drivers",
		requiredFields: ["StationId"],
		exampleResponse: {
			DriversOTPPreferenceList: [
				{
					DriverId: 4536,
					preference: 2,
				},
			],
		},
		handler: async (params, userMessage) => {
			if (!params?.StationId) return { missingFields: ["StationId"] };

			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetDriverOTPreferenceList?StationId=${params.StationId}`
				);

				let DriversOTPPreferenceList = data?.data?.map((item) => ({
					DriverId: item?.driverId,
					preference: item?.preference,
				}));

				return await processIntentAndFormatResponse({
					userMessage,
					api: {
						name: "GetDriverOTPreferenceList",
						description: "Returns OTP preference for each drivers",
					},
					exampleResponse: {
						DriversOTPPreferenceList: [
							{
								DriverId: 4536,
								preference: 2,
							},
						],
					},
					actualData: { DriversOTPPreferenceList },
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
		description: "Returns drivers(LMDP) qualifications ",
		requiredFields: ["ClientId","FromDate","ToDate"],
		exampleResponse: {
			DriversOTPPreferenceList: [
				{
					DriverId: 4536,
					qualification: 2,
				},
			],
		},
		handler: async (params, userMessage) => {
			if (!params?.ClientId) return { missingFields: ["ClientId"] };
			if (!params?.FromDate) return { missingFields: ["FromDate"] };
			if (!params?.ToDate) return { missingFields: ["ToDate"] };

			console.log(params)
			console.log(
				`https://dotc-delivery.azurewebsites.net/GetLMDPMaxQualificationsList?ClientId=${params?.ClientId}&FromDate=${params?.FromDate}&ToDate=${params?.ToDate}`
			);

			try {
				const { data } = await axios.get(
					`https://dotc-delivery.azurewebsites.net/GetLMDPMaxQualificationsList?ClientId=${params?.ClientId}&FromDate=${params?.FromDate}&ToDate=${params?.ToDate}`
				);
	

				console.log(data, "response Data");
				let DriversMaxQualificationList = data?.data?.map((item) => ({
					DriverId: item?.driverId,
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
								DriverId: 4536,
								qualification: 2,
							},
						],
					},
					actualData: { DriversMaxQualificationList },
				});
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers Drivers MaxQualification list",
				};
			}
		},
	},
];
