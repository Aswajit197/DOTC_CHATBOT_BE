const axios = require("axios");
const API_BASE = process.env.API_BASE_URL;

module.exports = [
	{
		name: "GetDriverWeeklyWorkingHrList",
		description:
			"Returns a list of drivers with their total weekly working hours for the given station. Optionally filters by driverID.",
		requiredFields: ["StationId"],
		exampleResponse: {
			driversWeeklyWorkingHrList: [
				{ driverID: 1482, hours: 30 },
				{ driverID: 5527, hours: 40 },
			],
		},
		handler: async (params) => {
			if (!params?.StationId) return { missingFields: ["StationId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetDriverWeeklyWorkingHrList?StationId=${params.StationId}`);
				const driverList =
					data?.data?.map((item) => ({
						driverID: item?.driverId,
						hours: item?.hours,
					})) || [];

				// If driverID is passed, filter for that driver only
				if (params?.driverID) {
					const match = driverList.find((d) => d.driverID == params.driverID);
					if (!match) {
						return {
							message: `No working hour data found for driverID ${params.driverID}`,
							driversWeeklyWorkingHrList: [],
						};
					}
					return {
						driversWeeklyWorkingHrList: [match],
					};
				}

				// Otherwise return full list
				return { driversWeeklyWorkingHrList: driverList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
				};
			}
		},
	},
	// {
	// 	name: "GetSchedulingShiftTypeList",
	// 	description:
	// 		"Fetches available shift types and their details for scheduling. Can filter by shiftTitle or return specific fields like minQualification or hoursPerShift.",
	// 	requiredFields: ["ClientId"],
	// 	optionalFields: ["shiftTitle", "onlyField"], // NEW
	// 	exampleResponse: {
	// 		shiftTypeList: [
	// 			{
	// 				shiftTitle: "Step Van",
	// 				shiftId: 241,
	// 				minQualification: 2,
	// 				hoursPerShift: 10,
	// 			},
	// 		],
	// 	},
	// 	handler: async (params) => {
	// 		if (!params?.ClientId) return { missingFields: ["ClientId"] };

	// 		try {
	// 			const { data } = await axios.get(`${API_BASE}/GetSchedulingShiftTypeList?ClientId=${params.ClientId}`);

	// 			// Full list mapped first
	// 			let shiftTypeList = data?.data?.map((item) => ({
	// 				shiftTitle: item?.description,
	// 				shiftId: item?.shiftId,
	// 				minQualification: item?.minQualification,
	// 				hoursPerShift: item?.hoursPerShift,
	// 			}));

	// 			// ✅ Filter by shift title (case-insensitive match)
	// 			if (params?.shiftTitle) {
	// 				const shiftTitleLower = params.shiftTitle.toLowerCase();
	// 				shiftTypeList = shiftTypeList.filter((shift) => shift.shiftTitle?.toLowerCase() === shiftTitleLower);
	// 			}

	// 			// ✅ If only a specific field is requested, return only that field for each item
	// 			if (params?.onlyField) {
	// 				const allowedFields = ["minQualification", "hoursPerShift"];
	// 				if (!allowedFields.includes(params.onlyField)) {
	// 					return {
	// 						error: true,
	// 						message: `Invalid onlyField value. Allowed: ${allowedFields.join(", ")}`,
	// 					};
	// 				}

	// 				// Return only shiftTitle and requested field
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
	{
		name: "GetDayFactor",
		description: "Returns priority factors for each day of the week. If a dayName is provided, returns only that day's factor.",
		requiredFields: ["ClientId"],
		optionalFields: ["dayName"],
		exampleResponse: {
			dayFactors: [{ id: 2, dayName: "Monday", factor: 2 }],
		},
		handler: async (params) => {
			if (!params?.ClientId) return { missingFields: ["ClientId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetDayFactor?ClientId=${params.ClientId}`);
				let dayFactors = data?.data?.map((item) => ({
					id: item.id,
					dayName: item.dayName,
					factor: item.factor,
				}));

				// ✅ Filter by specific dayName if provided (case-insensitive)
				if (params?.dayName) {
					const dayNameLower = params.dayName.toLowerCase();
					dayFactors = dayFactors.filter((d) => d.dayName.toLowerCase() === dayNameLower);
				}

				return { dayFactors };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch day factor data.",
				};
			}
		},
	},
	{
		name: "GetSchedulingShiftTypeList",
		description:
			"Fetches available shift types and their details for scheduling. Supports filtering by shiftTitle or fields like minQualification and hoursPerShift. Can also return shifts with maximum or minimum values.",
		requiredFields: ["ClientId"],
		optionalFields: ["shiftTitle", "onlyField", "filter"], // filter: 'max' or 'min'
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
		handler: async (params) => {
			if (!params?.ClientId) return { missingFields: ["ClientId"] };

			try {
				const { data } = await axios.get(`${API_BASE}/GetSchedulingShiftTypeList?ClientId=${params.ClientId}`);
				let shiftTypeList = data?.data?.map((item) => ({
					shiftTitle: item?.description,
					shiftId: item?.shiftId,
					minQualification: item?.minQualification,
					hoursPerShift: item?.hoursPerShift,
				}));

				if (params?.shiftTitle) {
					const shiftTitleLower = params.shiftTitle.toLowerCase();
					shiftTypeList = shiftTypeList.filter((shift) => shift.shiftTitle?.toLowerCase() === shiftTitleLower);
				}

				if (params?.onlyField) {
					const validFields = ["minQualification", "hoursPerShift"];
					if (!validFields.includes(params.onlyField)) {
						return { error: true, message: `Invalid onlyField. Allowed: ${validFields.join(", ")}` };
					}

					// Support 'max' or 'min' filter
					if (params?.filter === "max") {
						const maxVal = Math.max(...shiftTypeList.map((s) => s[params.onlyField]));
						shiftTypeList = shiftTypeList.filter((s) => s[params.onlyField] === maxVal);
					} else if (params?.filter === "min") {
						const minVal = Math.min(...shiftTypeList.map((s) => s[params.onlyField]));
						shiftTypeList = shiftTypeList.filter((s) => s[params.onlyField] === minVal);
					}

					// Return shiftTitle + requested field
					shiftTypeList = shiftTypeList.map((shift) => ({
						shiftTitle: shift.shiftTitle,
						[params.onlyField]: shift[params.onlyField],
					}));
				}

				return { shiftTypeList };
			} catch (err) {
				return {
					error: true,
					message: err.response?.data?.message || "Failed to fetch scheduling shift types.",
				};
			}
		},
	},
];
