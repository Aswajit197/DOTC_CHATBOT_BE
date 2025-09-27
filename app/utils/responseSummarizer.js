const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stringSimilarity = require('string-similarity');

/**
 * Enhanced summarizer with built-in entity matching and SMART context tracking
 */
class EntityAwareSummarizer {
    constructor() {
        this.entityCache = new Map(); // sessionId -> entity context
        this.similarityThreshold = 0.85;
        this.contextTimeout = 300000; // 5 minutes - clear old context
    }

    /**
     * Main function to create data summary with entity context
     */
    createDynamicDataSummary(apiData, apiName, userMessage, sessionId) {
        if (!apiData) return { summary: '[No data available]', context: null };
        
        let summary = '';
        let context = null;
        
        if (Array.isArray(apiData)) {
            summary = this.summarizeArrayData(apiData, apiName, userMessage);
            context = this.extractEntityContext(apiData, apiName, sessionId, userMessage);
        } else if (typeof apiData === 'object') {
            summary = this.summarizeObjectData(apiData, apiName, userMessage);
        } else {
            summary = `[Data: ${String(apiData).substring(0, 50)}]`;
        }
        
        return {
            summary: summary,
            context: context
        };
    }

    /**
     * SMART Entity Context Extraction with Auto-Clearing
     */
    extractEntityContext(apiData, apiName, sessionId, userMessage) {
        if (!Array.isArray(apiData) || apiData.length === 0) return null;
        
        const entityConfig = this.getEntityConfig(apiName);
        if (!entityConfig) return null;
        
        // Get previous context and check if we should keep it
        const previousContext = this.getLatestEntityContext(sessionId);
        const managedContext = this.manageEntityContext(sessionId, apiName, userMessage, previousContext);
        
        // If context was cleared or doesn't exist, create new one
        if (!managedContext) {
            const entityNames = apiData.slice(0, 50).map(item => {
                const nameField = entityConfig.nameField;
                const name = item[nameField] || item.name || item.title || item.description;
                return name ? this.normalizeEntityName(name) : null;
            }).filter(name => name);
            
            if (entityNames.length === 0) return null;
            
            const newContext = {
                entityType: entityConfig.entityType,
                entityNames: entityNames,
                apiName: apiName,
                timestamp: Date.now()
            };
            
            this.cacheEntityContext(sessionId, newContext);
            console.log('🔹 Created new entity context:', {
                entityType: newContext.entityType,
                entityCount: newContext.entityNames.length
            });
            return newContext;
        }
        
        // Use managed context (either kept previous or null)
        console.log('🔹 Using existing entity context:', {
            entityType: managedContext.entityType,
            entityCount: managedContext.entityNames.length
        });
        return managedContext;
    }

    /**
     * Smart context management - auto-clear when inappropriate
     */
    manageEntityContext(sessionId, currentApiName, userMessage, previousContext) {
        // Clear context if it's too old
        this.clearExpiredContexts();
        
        if (!previousContext) return null;
        
        // Check if we should clear context based on user message
        if (this.shouldClearContext(userMessage, previousContext, currentApiName)) {
            this.clearEntityContext(sessionId);
            console.log('🔹 Auto-cleared entity context due to message mismatch');
            return null;
        }
        
        return previousContext;
    }

    /**
     * Detect when to clear context based on user intent
     */
    shouldClearContext(userMessage, previousContext, currentApiName) {
        const message = userMessage.toLowerCase();
        
        // 1. Clear if user explicitly asks for new/different data
        const newDataIndicators = [
            'new', 'different', 'another', 'more', 'additional',
            'give me', 'show me', 'get me', 'list', 'find'
        ];
        
        const isExplicitNewRequest = newDataIndicators.some(indicator => 
            message.includes(indicator) && !this.isFollowUpQuery(message)
        );
        
        if (isExplicitNewRequest) {
            console.log('🔹 Detected explicit new data request - clearing context');
            return true;
        }
        
        // 2. Clear if entity types don't match (e.g., drivers vs locations)
        const currentEntityConfig = this.getEntityConfig(currentApiName);
        if (currentEntityConfig && currentEntityConfig.entityType !== previousContext.entityType) {
            console.log('🔹 Entity type mismatch - clearing context');
            return true;
        }
        
        // 3. Clear if user mentions specific numbers that don't match context
        const numberMatch = this.checkNumberMismatch(message, previousContext);
        if (numberMatch === 'mismatch') {
            console.log('🔹 Number mismatch detected - clearing context');
            return true;
        }
        
        return false;
    }

    /**
     * Detect if this is a true follow-up query
     */
    isFollowUpQuery(userMessage) {
        const message = userMessage.toLowerCase();
        const followUpIndicators = [
            'this data', 'these', 'same', 'previous', 'their', 
            'that data', 'the above', 'the same', 'those', 'them'
        ];
        
        return followUpIndicators.some(indicator => message.includes(indicator));
    }

    /**
     * Check if user mentions numbers that conflict with current context
     */
    checkNumberMismatch(userMessage, previousContext) {
        const message = userMessage.toLowerCase();
        
        // Extract numbers from message
        const numbers = message.match(/\d+/g) || [];
        const contextCount = previousContext.entityNames?.length || 0;
        
        if (numbers.length > 0 && contextCount > 0) {
            const mentionedNumber = parseInt(numbers[0]);
            
            // If user asks for significantly different number than context
            if (mentionedNumber > 0) {
                const ratio = mentionedNumber / contextCount;
                
                // Clear if user asks for very different quantity (more than 2x difference)
                if (ratio < 0.5 || ratio > 2) {
                    return 'mismatch';
                } else if (ratio >= 0.8 && ratio <= 1.2) {
                    return 'match';
                }
            }
        }
        
        return 'neutral';
    }

    /**
     * Clear expired contexts (older than 5 minutes)
     */
    clearExpiredContexts() {
        const now = Date.now();
        for (const [sessionId, sessionContext] of this.entityCache.entries()) {
            if (now - sessionContext.lastUpdated > this.contextTimeout) {
                this.entityCache.delete(sessionId);
                console.log('🔹 Cleared expired context for session:', sessionId);
            }
        }
    }

    /**
     * Clear entity context for a session
     */
    clearEntityContext(sessionId) {
        if (this.entityCache.has(sessionId)) {
            this.entityCache.delete(sessionId);
            console.log('🔹 Cleared entity context for session:', sessionId);
        }
    }

    /**
     * Cache entity context for session
     */
    cacheEntityContext(sessionId, context) {
        if (!this.entityCache.has(sessionId)) {
            this.entityCache.set(sessionId, {
                contexts: [],
                lastUpdated: Date.now()
            });
        }
        
        const sessionContext = this.entityCache.get(sessionId);
        sessionContext.contexts.push(context);
        
        // Keep only last 5 contexts to prevent memory issues
        if (sessionContext.contexts.length > 5) {
            sessionContext.contexts = sessionContext.contexts.slice(-5);
        }
        
        sessionContext.lastUpdated = Date.now();
    }

    /**
     * Get latest entity context for a session
     */
    getLatestEntityContext(sessionId, entityType = null) {
        if (!this.entityCache.has(sessionId)) return null;
        
        const sessionContext = this.entityCache.get(sessionId);
        const contexts = sessionContext.contexts;
        
        if (contexts.length === 0) return null;
        
        if (entityType) {
            // Filter by specific entity type
            const filtered = contexts.filter(ctx => ctx.entityType === entityType);
            return filtered.length > 0 ? filtered[filtered.length - 1] : null;
        }
        
        // Return most recent context
        return contexts[contexts.length - 1];
    }

    /**
     * Filter data based on previous entity context (INTEGRATED MATCHING)
     */
    filterDataByEntityContext(apiData, targetContext) {
        if (!Array.isArray(apiData) || !targetContext) return apiData;
        
        const { entityType, entityNames, apiName } = targetContext;
        const matchedData = [];
        const unmatchedEntities = [];
        
        entityNames.forEach(targetName => {
            const match = this.findMatchingEntity(targetName, apiData, entityType);
            if (match) {
                matchedData.push(match);
            } else {
                unmatchedEntities.push(targetName);
            }
        });
        
        console.log('🔹 Entity matching results:');
        console.log('   - Entity type:', entityType);
        console.log('   - Target entities:', entityNames.length);
        console.log('   - Matched:', matchedData.length);
        console.log('   - Unmatched:', unmatchedEntities.length);
        
        // Return matched data if we found matches, otherwise return original
        return matchedData.length > 0 ? matchedData : apiData;
    }

    /**
     * Enhanced entity matching with multiple strategies
     */
    findMatchingEntity(targetName, entityList, entityType) {
        if (!entityList || !Array.isArray(entityList)) return null;
        
        const strategies = [
            this.exactMatchStrategy.bind(this),
            this.partialMatchStrategy.bind(this),
            this.firstNameMatchStrategy.bind(this),
            this.similarityMatchStrategy.bind(this)
        ];
        
        for (const strategy of strategies) {
            const match = strategy(targetName, entityList, entityType);
            if (match) {
                return match;
            }
        }
        
        return null;
    }

    /**
     * Matching strategies
     */
    exactMatchStrategy(targetName, entityList, entityType) {
        const normalizedTarget = this.normalizeEntityName(targetName);
        const nameField = this.getEntityNameField(entityType);
        
        return entityList.find(entity => 
            this.normalizeEntityName(entity[nameField]) === normalizedTarget
        );
    }

    partialMatchStrategy(targetName, entityList, entityType) {
        const normalizedTarget = this.normalizeEntityName(targetName);
        const nameField = this.getEntityNameField(entityType);
        
        return entityList.find(entity => {
            const entityName = this.normalizeEntityName(entity[nameField]);
            return entityName.includes(normalizedTarget) || normalizedTarget.includes(entityName);
        });
    }

    firstNameMatchStrategy(targetName, entityList, entityType) {
        if (entityType !== 'driver') return null;
        
        const normalizedTarget = this.normalizeEntityName(targetName);
        const targetFirstName = normalizedTarget.split(' ')[0];
        const nameField = this.getEntityNameField(entityType);
        
        return entityList.find(entity => {
            const driverFirstName = this.normalizeEntityName(entity[nameField]).split(' ')[0];
            return driverFirstName === targetFirstName;
        });
    }

    similarityMatchStrategy(targetName, entityList, entityType) {
        const normalizedTarget = this.normalizeEntityName(targetName);
        const nameField = this.getEntityNameField(entityType);
        
        let bestMatch = null;
        let highestSimilarity = 0;
        
        entityList.forEach(entity => {
            const entityName = this.normalizeEntityName(entity[nameField]);
            const similarity = stringSimilarity.compareTwoStrings(normalizedTarget, entityName);
            
            if (similarity > highestSimilarity && similarity >= this.similarityThreshold) {
                highestSimilarity = similarity;
                bestMatch = entity;
            }
        });
        
        return bestMatch;
    }

    /**
     * Normalize entity names for consistent matching
     */
    normalizeEntityName(name) {
        if (!name) return '';
        
        return name
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }

    /**
     * Get appropriate name field for entity type
     */
    getEntityNameField(entityType) {
        const fieldMap = {
            'driver': 'driverName',
            'location': 'locationName', 
            'operation': 'name',
            'shift': 'shiftTitle',
            'default': 'name'
        };
        
        return fieldMap[entityType] || fieldMap.default;
    }

    /**
     * Configuration for different entity types
     */
    getEntityConfig(apiName) {
        const entityConfigs = {
            // Driver-related APIs
            'GetDriverByClientId': { entityType: 'driver', nameField: 'driverName' },
            'GetDriverWeeklyWorkingHrList': { entityType: 'driver', nameField: 'driverName' },
            'GetBlobShiftDriverData': { entityType: 'driver', nameField: 'driverName' },
            'GetLMDPDayPreferenceList': { entityType: 'driver', nameField: 'driverName' },
            'GetDriverOTPreferenceList': { entityType: 'driver', nameField: 'driverName' },
            'GetLMDPMaxQualificationsList': { entityType: 'driver', nameField: 'driverName' },
            'GetTimeOffRequestForBackend': { entityType: 'driver', nameField: 'driverName' },
            
            // Location-related APIs
            'GetLocationListForBackEnd': { entityType: 'location', nameField: 'locationName' },
            
            // Operation-related APIs
            'GetOperationListForBackEnd': { entityType: 'operation', nameField: 'name' },
            
            // Shift-related APIs
            'GetSchedulingShiftTypeList': { entityType: 'shift', nameField: 'shiftTitle' },
        };
        
        return entityConfigs[apiName];
    }

    /**
     * Existing summarization functions
     */
    summarizeArrayData(dataArray, apiName, userMessage) {
        if (dataArray.length === 0) return '[Empty dataset]';
        
        const recordCount = dataArray.length;
        const apiContext = this.getApiContext(apiName);
        const insights = this.extractKeyInsights(dataArray, apiContext, userMessage);
        
        return `[${apiContext.displayName}: ${recordCount} records, ${insights.join(', ')}]`;
    }

    summarizeObjectData(dataObj, apiName, userMessage) {
        const fields = Object.keys(dataObj || {});
        const apiContext = this.getApiContext(apiName);
        
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

    getApiContext(apiName) {
        const contextMap = {
            'GetDriverByClientId': { displayName: 'Drivers', entityName: 'drivers' },
            'GetDriverWeeklyWorkingHrList': { displayName: 'Driver Hours', entityName: 'hours' },
            'GetBlobShiftDriverData': { displayName: 'Driver Shifts', entityName: 'shifts' },
            'GetLMDPDayPreferenceList': { displayName: 'Day Preferences', entityName: 'preferences' },
            'GetDriverOTPreferenceList': { displayName: 'OT Preferences', entityName: 'preferences' },
            'GetLMDPMaxQualificationsList': { displayName: 'Qualifications', entityName: 'qualifications' },
            'GetTimeOffRequestForBackend': { displayName: 'Time Off Requests', entityName: 'requests' },
            'GetLocationListForBackEnd': { displayName: 'Locations', entityName: 'locations' },
            'GetSchedulingShiftTypeList': { displayName: 'Shift Types', entityName: 'shifts' },
            'GetOperationListForBackEnd': { displayName: 'Operations', entityName: 'operations' }
        };
        
        return contextMap[apiName] || { displayName: apiName || 'Data', entityName: 'records' };
    }

    extractKeyInsights(dataArray, apiContext, userMessage) {
        const insights = [];
        if (dataArray.length === 0) return ['empty dataset'];
        
        insights.push(`${dataArray.length} ${apiContext.entityName}`);
        
        // Numerical insights
        if (apiContext.numericalFields && apiContext.numericalFields.length > 0 && dataArray.length > 0) {
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
        
        return insights.slice(0, 3);
    }

    /**
     * Keep your existing functions for compatibility
     */
    summarizeLongResponse(message, maxLength = 200) {
        if (!message || message.length <= maxLength) return message;
        
        if (message.includes('turn this into a graph') || 
            message.includes('Would you like me to turn this into')) {
            return message;
        }
        
        if (message.includes('<table') || message.includes('<ul')) {
            return `[Data table with multiple entries - ask for details if needed]`;
        }
        
        return message.substring(0, maxLength) + '...';
    }

    summarizeLongResponseSync(message, maxLength = 150) {
        if (!message || message.length <= maxLength) return message;
        
        if (message.includes('<table')) {
            const rowCount = (message.match(/<tr>/g) || []).length - 1;
            
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
}

// Create singleton instance
const summarizer = new EntityAwareSummarizer();

// Export functions for backward compatibility
module.exports = { 
    summarizeLongResponse: summarizer.summarizeLongResponse.bind(summarizer),
    summarizeLongResponseSync: summarizer.summarizeLongResponseSync.bind(summarizer),
    createDynamicDataSummary: summarizer.createDynamicDataSummary.bind(summarizer),
    
    // Export the new integrated matching functions
    normalizeEntityName: summarizer.normalizeEntityName.bind(summarizer),
    findMatchingEntity: summarizer.findMatchingEntity.bind(summarizer),
    filterDataByEntityContext: summarizer.filterDataByEntityContext.bind(summarizer),
    getLatestEntityContext: summarizer.getLatestEntityContext.bind(summarizer),
    clearEntityContext: summarizer.clearEntityContext.bind(summarizer)
};