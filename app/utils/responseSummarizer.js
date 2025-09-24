const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Universal data summarizer with dynamic API handling
 */
const summarizeLongResponse = (message, maxLength = 200) => {
    if (!message || message.length <= maxLength) return message;
    
    // Don't summarize if it contains visualization follow-up question
    if (message.includes('turn this into a graph') || 
        message.includes('Would you like me to turn this into')) {
        return message; // Keep full message for visualization context
    }
    
    // For HTML data tables, create a brief summary
    if (message.includes('<table') || message.includes('<ul')) {
        return `[Data table with multiple entries - ask for details if needed]`;
    }
    
    return message.substring(0, maxLength) + '...';
};

/**
 * Dynamic summarizer that works with any API response structure
 */
function createDynamicDataSummary(apiData, apiName, userMessage) {
    if (!apiData) return '[No data available]';
    
    // Handle different data structures
    if (Array.isArray(apiData)) {
        return summarizeArrayData(apiData, apiName, userMessage);
    } else if (typeof apiData === 'object') {
        return summarizeObjectData(apiData, apiName, userMessage);
    } else {
        return `[Data: ${String(apiData).substring(0, 50)}]`;
    }
}

function summarizeArrayData(dataArray, apiName, userMessage) {
    if (dataArray.length === 0) return '[Empty dataset]';
    
    const recordCount = dataArray.length;
    const firstItem = dataArray[0];
    const fields = Object.keys(firstItem || {});
    
    // API-specific context
    const apiContext = getApiContext(apiName);
    
    // Extract key insights based on API type
    const insights = extractKeyInsights(dataArray, apiContext, userMessage);
    
    return `[${apiContext.displayName}: ${recordCount} records, ${insights.join(', ')}]`;
}

function summarizeObjectData(dataObj, apiName, userMessage) {
    const fields = Object.keys(dataObj || {});
    const apiContext = getApiContext(apiName);
    
    // Extract key values from object
    const keyValues = [];
    fields.forEach(field => {
        const value = dataObj[field];
        if (typeof value === 'number' && value !== 0) {
            keyValues.push(`${field}: ${value}`);
        } else if (typeof value === 'string' && value.length < 30) {
            keyValues.push(`${field}: ${value}`);
        }
    });
    
    return `[${apiContext.displayName}: ${keyValues.slice(0, 3).join(', ')}]`;
}

/**
 * API-specific context mapping
 */
function getApiContext(apiName) {
    const contextMap = {
        'GetDriverByClientId': {
            displayName: 'Drivers',
            keyFields: ['driverName', 'driverId', 'status', 'email'],
            numericalFields: ['hours', 'age', 'rating'],
            entityName: 'drivers'
        },
        'GetDriverWeeklyWorkingHrList': {
            displayName: 'Driver Hours',
            keyFields: ['driverName', 'week', 'hours'],
            numericalFields: ['hours', 'overtime', 'total'],
            entityName: 'hours'
        },
        'GetStationList': {
            displayName: 'Stations',
            keyFields: ['stationName', 'stationId', 'location'],
            numericalFields: ['capacity', 'activeDrivers'],
            entityName: 'stations'
        },
        'GetShiftList': {
            displayName: 'Shifts',
            keyFields: ['shiftName', 'driverName', 'station'],
            numericalFields: ['duration', 'hours'],
            entityName: 'shifts'
        },
        'GetLeaveRequestList': {
            displayName: 'Leave Requests',
            keyFields: ['driverName', 'reason', 'status'],
            numericalFields: ['days', 'hours'],
            entityName: 'leave requests'
        }
        // Add more APIs as needed
    };
    
    return contextMap[apiName] || {
        displayName: apiName || 'Data',
        keyFields: [],
        numericalFields: [],
        entityName: 'records'
    };
}

/**
 * Extract key insights based on API type and user message
 */
function extractKeyInsights(dataArray, apiContext, userMessage) {
    const insights = [];
    
    if (dataArray.length === 0) return ['empty dataset'];
    
    // Basic count insight
    insights.push(`${dataArray.length} ${apiContext.entityName}`);
    
    // Numerical insights
    if (apiContext.numericalFields.length > 0 && dataArray.length > 0) {
        apiContext.numericalFields.forEach(field => {
            if (dataArray[0].hasOwnProperty(field)) {
                const values = dataArray.map(item => item[field]).filter(val => typeof val === 'number');
                if (values.length > 0) {
                    const total = values.reduce((a, b) => a + b, 0);
                    const avg = total / values.length;
                    insights.push(`avg ${field}: ${avg.toFixed(1)}`);
                }
            }
        });
    }
    
    // Status/category insights
    if (dataArray[0].hasOwnProperty('status')) {
        const statusCounts = {};
        dataArray.forEach(item => {
            const status = item.status || 'Unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        const mainStatus = Object.keys(statusCounts)[0];
        if (mainStatus) {
            insights.push(`status: ${mainStatus}`);
        }
    }
    
    // User message specific insights - WITH PROPER TYPE CHECKING
    if (userMessage && typeof userMessage === 'string') {
        const msg = userMessage.toLowerCase();
        if (msg.includes('average') || msg.includes('avg')) {
            // Already handled above
        } else if (msg.includes('total') || msg.includes('sum')) {
            apiContext.numericalFields.forEach(field => {
                if (dataArray[0].hasOwnProperty(field)) {
                    const total = dataArray.reduce((sum, item) => sum + (item[field] || 0), 0);
                    insights.push(`total ${field}: ${total}`);
                }
            });
        }
    }
    
    return insights.slice(0, 3); // Max 3 insights
}

/**
 * Quick sync version for history cleaning
 */
function summarizeLongResponseSync(message, maxLength = 150) {
    if (!message || message.length <= maxLength) return message;
    
    if (message.includes('<table')) {
        const rowCount = (message.match(/<tr>/g) || []).length - 1;
        
        // Detect content type from table
        if (message.toLowerCase().includes('driver')) {
            return `[${rowCount} drivers data]`;
        } else if (message.toLowerCase().includes('station')) {
            return `[${rowCount} stations data]`;
        } else if (message.toLowerCase().includes('shift')) {
            return `[${rowCount} shifts data]`;
        } else if (message.toLowerCase().includes('hour')) {
            return `[${rowCount} hours records]`;
        }
        
        return `[Table: ${rowCount} entries]`;
    }
    
    return message.substring(0, maxLength) + '...';
}

module.exports = { 
    summarizeLongResponse, 
    summarizeLongResponseSync,
    createDynamicDataSummary 
};