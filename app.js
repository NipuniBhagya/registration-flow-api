const express = require("express");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const flowDefinitions = {};
let currentNodeId = "";

app.post("/registration-flow", (req, res) => {
    const { appId, flowDefinition } = req.body;
    if (!appId || !flowDefinition) {
        return res.status(400).json({ error: "appId and flowDefinition are required" });
    }
    flowDefinitions[appId] = flowDefinition;
    res.json({ message: "Flow definition registered successfully." });
});

// Initiate the flow
app.post("/initiate", (req, res) => {
    const { appId } = req.body;
    if (!appId || !flowDefinitions[appId]) {
        return res.status(400).json({ error: "Invalid or missing appId." });
    }

    const def = flowDefinitions[appId];
    const startPage = def.flow.pages[0];
    currentNodeId = startPage.nodes[0];

    const flowId = uuidv4();
    const response = buildFlowResponse(flowId, "INCOMPLETE", "REGISTRATION", def, currentNodeId);
    res.json(response);
});

app.post("/submit", (req, res) => {
    const { appId, flowId, action, inputs } = req.body;
    if (!appId || !flowId || !action) {
        return res.status(400).json({ error: "appId, flowId, and action are required." });
    }

    const def = flowDefinitions[appId];
    if (!def) {
        return res.status(400).json({ error: "No flow definition found for appId." });
    }

    const currentNode = def.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) {
        return res.status(404).json({ error: "Node not found." });
    }

    let triggeredAction = null;

    currentNode.actions.map((a) => {
        if (a.action.executors  && a.action.executors[0].name === action) {
            triggeredAction = a;
        }

        if (a.action.type === action) {
            triggeredAction = a;
        }
    });


    if (!triggeredAction) {
        return res.status(404).json({ error: "Action not found." });
    }

    const type = triggeredAction.action.type.toUpperCase();

    if (type === "DONE") {
        return res.json({
            flowId: uuidv4(),
            flowStatus: "COMPLETED",
            flowType: "REGISTRATION",
            message: "Flow completed successfully."
        });
    }

    let nextNodeId = null;
    if (type === "NEXT" || type === "EXECUTOR") {
        if (triggeredAction.next && triggeredAction.next.length > 0) {
            nextNodeId = triggeredAction.next[0];
        }
    } else if (type === "PREVIOUS") {
        if (triggeredAction.previous && triggeredAction.previous.length > 0) {
            nextNodeId = triggeredAction.previous[0];
        }
    }

    if (!nextNodeId) {
        return res.status(500).json({ error: "No next or previous node available for action." });
    }

    currentNodeId = nextNodeId;

    const response = buildFlowResponse(flowId, "INCOMPLETE", "REGISTRATION", def, nextNodeId);
    res.json(response);
});

function buildFlowResponse(flowId, flowStatus, flowType, def, nodeId) {
    const node = def.nodes.find((n) => n.id === nodeId);
    if (!node) {
        throw new Error("Node not found: " + nodeId);
    }

    let finalElements = [];
    let finalBlocks = [];

    for (const elementId of node.elements) {
        const block = def.blocks.find(b => b.id === elementId);
        if (block) {
            finalBlocks.push({
                id: block.id,
                nodes: block.nodes
            });

            for (const blockNodeId of block.nodes) {
                const blockEl = def.elements.find(e => e.id === blockNodeId);
                if (blockEl) {
                    const transformed = elementToProperties(blockEl, def, node);
                    if (transformed) {
                        finalElements.push(transformed);
                    }
                }
            }

        } else {
            const el = def.elements.find(e => e.id === elementId);
            if (el) {
                const transformed = elementToProperties(el, def, node);
                if (transformed) {
                    finalElements.push(transformed);
                }
            }
        }
    }

    return {
        flowId,
        flowStatus,
        flowType,
        elements: finalElements,
        blocks: finalBlocks
    };
}

function elementToProperties(element, def, node) {
    const elem = {
        id: element.id,
        category: element.category,
        type: element.type,
        variant: element.variant
    };

    let actionConfig = null;
    const nodeAction = node.actions && node.actions.find(a => {

        return a.action.executors && a.action.executors.some(ex => ex.id === element.id);
    });

    if (nodeAction && nodeAction.action && nodeAction.action.type === "EXECUTOR") {
        const executor = nodeAction.action.executors[0];
        actionConfig = {
            type: "EXECUTOR",
            name: executor.name
        };
    }

    const properties = {};
    const fieldConfig = element.config && element.config.field ? element.config.field : {};
    const stylesConfig = element.config && element.config.styles ? element.config.styles : {};

    if (element.category === "DISPLAY" && element.type === "TYPOGRAPHY") {
        properties.className = "wso2is-typography-h3";
        properties.text = "sign.up.form.title";
        properties.styles = { textAlign: "center" };
    } else if (element.category === "DISPLAY" && element.type === "DIVIDER") {
        properties.className = "wso2is-divider-horizontal";
        properties.text = fieldConfig.text || "Or";
        properties.styles = {};
    } else if (element.category === "FIELD" && element.type === "INPUT") {
        properties.type = fieldConfig.type || "text";
        properties.name = fieldConfig.name || "";
        properties.hint = fieldConfig.hint || "";
        properties.label = mapLabelToI18n(fieldConfig.label);
        properties.placeholder = mapPlaceholderToI18n(fieldConfig.placeholder);
        properties.required = !!fieldConfig.required;
        properties.multiline = !!fieldConfig.multiline;
        properties.defaultValue = fieldConfig.defaultValue || "";
        properties.value = "";
        properties.dataType = "string";
        properties.isRequired = properties.required;
        properties.isReadOnly = false;

        if (properties.name === "username") {
            properties.className = "wso2is-username-input";
            properties.validationRegex = "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$";
        } else {
            properties.className = "wso2is-text-input";
        }

        if (fieldConfig.minLength) properties.minLength = fieldConfig.minLength;
        if (fieldConfig.maxLength) properties.maxLength = fieldConfig.maxLength;
        properties.styles = properties.styles || {};
    } else if (element.category === "ACTION" && element.type === "BUTTON") {
        properties.type = fieldConfig.type || "submit";
        properties.className = actionConfig && actionConfig.type === "EXECUTOR"
            ? "wso2is-button"
            : "wso2is-social-button";

        properties.text = mapActionTextToI18n(fieldConfig.text || fieldConfig.label || "Submit");
        properties.styles = { width: "100%" };

        if (element.variant === "SOCIAL" || element.variant === "SOCIAL_BUTTON") {
            properties.className = "wso2is-social-button";
        }
    }

    if (actionConfig) {
        elem.action = actionConfig;
    }

    elem.properties = properties;
    return elem;
}

function mapLabelToI18n(label) {
    if (!label) return "";
    const lower = label.toLowerCase();
    if (lower.includes("username")) return "sign.up.form.fields.username.label";
    if (lower.includes("first name")) return "sign.up.form.fields.firstName.label";
    if (lower.includes("last name")) return "sign.up.form.fields.lastName.label";
    if (lower.includes("password")) return "sign.up.form.fields.password.label";
    if (lower.includes("email")) return "sign.up.form.fields.email.label";
    return label; 
}

function mapPlaceholderToI18n(placeholder) {
    if (!placeholder) return "";
    const lower = placeholder.toLowerCase();
    if (lower.includes("username")) return "sign.up.form.fields.username.placeholder";
    if (lower.includes("first name")) return "sign.up.form.fields.firstName.placeholder";
    if (lower.includes("last name")) return "sign.up.form.fields.lastName.placeholder";
    if (lower.includes("email")) return "sign.up.form.fields.email.placeholder";
    return placeholder;
}

function mapActionTextToI18n(text) {
    const lower = text.toLowerCase();
    if (lower.includes("continue with password")) {
        return "sign.up.form.button.continue.with.password";
    } else if (lower.includes("continue with email otp")) {
        return "sign.up.form.button.continue.with.email.otp";
    } else if (lower.includes("continue with google")) {
        return "sign.up.form.button.continue.with.google";
    } else if (lower.includes("continue")) {
        return "sign.up.form.button.continue";
    } else if (lower.includes("next")) {
        return "sign.up.form.button.next";
    } else if (lower.includes("done")) {
        return "sign.up.form.button.done";
    }
    return text;
}


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
