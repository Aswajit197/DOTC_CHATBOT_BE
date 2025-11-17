// ===== UTILITY FUNCTIONS =====

function getNestedValue(obj, path) {
	if (!path) return obj;
	return path.split(".").reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), obj);
}

function isMetadataField(fieldName) {
	if (!fieldName) return false;
	const metadataPatterns = [
		/^id$/i,
		/.*_id$/i,
		/.*Id$/,
		/^uid$/i,
		/^uuid$/i,
		/^guid$/i,
		/timestamp/i,
		/created/i,
		/updated/i,
		/modified/i,
		/version/i,
		/index/i,
		/position/i,
		/order/i,
		/status/i,
		/state/i,
		/type/i,
		/^EDV$/i,
		/^80f3dfsd$/i,
	];
	return metadataPatterns.some((pattern) => pattern.test(fieldName));
}

function extractNumbers(data, fieldPath = null, excludeZeros = false) {
	const numbers = [];
	const shouldInclude = (value) => {
		if (typeof value !== "number" || isNaN(value)) return false;
		if (excludeZeros && value === 0) return false;
		return true;
	};

	if (fieldPath) {
		if (Array.isArray(data)) {
			data.forEach((item) => {
				const value = getNestedValue(item, fieldPath);
				if (typeof value === "object" && value !== null) {
					Object.values(value).forEach((val) => {
						if (shouldInclude(val)) numbers.push(val);
					});
				} else if (shouldInclude(value)) {
					numbers.push(value);
				}
			});
		} else {
			const value = getNestedValue(data, fieldPath);
			if (shouldInclude(value)) numbers.push(value);
		}
		return numbers;
	}

	function traverse(current, currentKey = null) {
		if (shouldInclude(current) && !isMetadataField(currentKey)) {
			numbers.push(current);
			return;
		}
		if (Array.isArray(current)) {
			current.forEach((item) => traverse(item));
		} else if (typeof current === "object" && current !== null) {
			Object.entries(current).forEach(([key, value]) => {
				if (!isMetadataField(key)) traverse(value, key);
			});
		}
	}

	traverse(data);
	return numbers;
}

// ===== CALCULATION FUNCTIONS =====

function calculateAverage({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	const average = sum / numbers.length;

	return {
		average: parseFloat(average.toFixed(2)),
		count: numbers.length,
		total_sum: parseFloat(sum.toFixed(2)),
		exclude_zeros,
	};
}

function calculateSum({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	return {
		sum: parseFloat(sum.toFixed(2)),
		count: numbers.length,
		exclude_zeros,
	};
}

function calculateDeviation({ data, field_path, population = false, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };
	if (numbers.length === 1) return { standard_deviation: 0, variance: 0, mean: numbers[0], count: 1 };

	const mean = numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
	const squaredDifferences = numbers.map((num) => Math.pow(num - mean, 2));
	const variance = squaredDifferences.reduce((acc, diff) => acc + diff, 0) / (population ? numbers.length : numbers.length - 1);
	const standardDeviation = Math.sqrt(variance);

	return {
		standard_deviation: parseFloat(standardDeviation.toFixed(2)),
		variance: parseFloat(variance.toFixed(2)),
		mean: parseFloat(mean.toFixed(2)),
		count: numbers.length,
		type: population ? "population" : "sample",
	};
}

function calculatePercentageDeviation({ data, field_path = null, exclude_zeros = true }) {
	let itemsWithValues = [];

	if (Array.isArray(data) && data.length > 0 && data[0]?.shifts) {
		itemsWithValues = data.map((driver) => {
			const shifts = driver.shifts || {};
			let totalValue = 0;

			Object.entries(shifts).forEach(([shiftType, hours]) => {
				if (isMetadataField(shiftType)) return;
				if (typeof hours === "number" && !isNaN(hours)) {
					if (!exclude_zeros || hours !== 0) {
						totalValue += hours;
					}
				}
			});

			return {
				name: driver.driverName || driver.name || `Driver ${driver.driverId}`,
				id: driver.driverId || driver.id,
				value: totalValue,
				rawData: driver,
			};
		});
	} else if (Array.isArray(data)) {
		itemsWithValues = data
			.map((item, index) => {
				const value = field_path ? getNestedValue(item, field_path) : typeof item === "number" ? item : null;

				if (typeof value === "number" && !isNaN(value)) {
					if (!exclude_zeros || value !== 0) {
						return {
							name: item.name || item.driverName || item.dayName || `Item ${index + 1}`,
							id: item.id || index,
							value: value,
							rawData: item,
						};
					}
				}
				return null;
			})
			.filter(Boolean);
	}

	if (itemsWithValues.length === 0) return { error: "No valid numbers found for deviation calculation" };

	const values = itemsWithValues.map((item) => item.value);
	const average = values.reduce((sum, val) => sum + val, 0) / values.length;

	const results = itemsWithValues.map((item) => {
		const deviation = item.value - average;
		const percentageDeviation = average !== 0 ? (deviation / average) * 100 : 0;

		return {
			name: item.name,
			id: item.id,
			value: item.value,
			deviation: parseFloat(deviation.toFixed(2)),
			percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
			rawData: item.rawData,
		};
	});

	results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

	return {
		average: parseFloat(average.toFixed(2)),
		totalItems: results.length,
		results,
		summary: {
			highestDeviation: results[0]?.percentageDeviation || 0,
			highestDeviationItem: results[0]?.name || "N/A",
			lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
			lowestDeviationItem: results[results.length - 1]?.name || "N/A",
			averageDeviation: parseFloat(
				(results.reduce((sum, r) => sum + Math.abs(r.percentageDeviation), 0) / results.length).toFixed(2)
			),
		},
	};
}

function calculateMinMax({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	return {
		min: Math.min(...numbers),
		max: Math.max(...numbers),
		range: Math.max(...numbers) - Math.min(...numbers),
		count: numbers.length,
	};
}

// ===== MAIN CALCULATION ENGINE =====

function performCalculations(data, intent) {
	const { calculationType, fieldPath, excludeZeros } = intent;

	console.log(`📊 Performing calculation: ${calculationType}`);

	try {
		switch (calculationType) {
			case "average":
			case "mean":
				return {
					type: "average",
					result: calculateAverage({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "sum":
			case "total":
				return {
					type: "sum",
					result: calculateSum({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "deviation":
				return {
					type: "standardDeviation",
					result: calculateDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "percentageDeviation":
				return {
					type: "percentageDeviation",
					result: calculatePercentageDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "minMax":
				return {
					type: "minMax",
					result: calculateMinMax({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			default:
				return null;
		}
	} catch (error) {
		console.error("❌ Calculation error:", error.message);
		return null;
	}
}

module.exports = {
	getNestedValue,
	isMetadataField,
	extractNumbers,
	calculateAverage,
	calculateSum,
	calculateDeviation,
	calculatePercentageDeviation,
	calculateMinMax,
	performCalculations,
};
