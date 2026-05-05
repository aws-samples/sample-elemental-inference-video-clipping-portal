import React, { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Box, Button, ButtonDropdown, Checkbox, ColumnLayout, Container, Form, FormField, Header, Input, Link, List, Modal, Multiselect, RadioGroup, Select, SpaceBetween, Textarea, } from "@cloudscape-design/components";
import DateRangePicker from "@cloudscape-design/components/date-range-picker";
import ApiService from "../../../services/apiService";
import { CreateEventRequest, Template } from "../../../types";

interface CreateEventProps {
    channels: any[];
    showDialog: boolean;
    setShowDialog: (showDialog: boolean) => void;
    onSubmit?: () => void;
}

const getPriorityColor = (priority: number) => {
    switch (priority) {
        case 1:
            return "severity-critical";
        case 2:
            return "severity-high";
        case 3:
            return "severity-medium";
        case 4:
            return "severity-low";
        case 5:
            return "severity-neutral";
    }
};
const CreateEvent: React.FC<CreateEventProps> = ({ channels, showDialog, setShowDialog, onSubmit }) => {
    const apiService = ApiService.getInstance();
    const [channelOptions, setChannelOptions] = useState<{ label: string; value: string }[]>([]);
    const [selectedChannel, setSelectedChannel] = useState<any>(null);
    const [eventTypes, setEventTypes] = useState<{ label: string; value: string }[]>([]);
    const [selectedEventType, setSelectedEventType] = useState<any>();
    const [allKeyMoments, setAllKeyMoments] = useState<any>();
    const [keyMoments, setKeyMoments] = useState([]);
    const [selectedKeyMoments, setSelectedKeyMoments] = useState<any>([]);
    const [eventName, setEventName] = useState("");
    const [description, setDescription] = useState("");
    const [eventTime, setEventTime] = React.useState<any>(undefined);
    const [autoGenerateHighlight, setAutoGenerateHighlight] = useState(true);
    const [saveTemplate, setSaveTemplate] = useState("yes");
    const [outputSettings, setOutputSettings] = useState<Template>({
        name: "Sample Template Name",
        resolution: "1080p",
        format: "HLS",
        backgroundMusic: false,
        id: "",
        clipLength: 60,
        keyMoments: [],
        gameType: "basketball"
    });
    const [templateOptions, setTemplateOptions] = useState<{ label: string; value: string }[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<any>(null);

    const resetForm = () => {
        setEventName("");
        setDescription("");
        setEventTime(undefined);
        setAutoGenerateHighlight(true);
        setSaveTemplate("yes");
        setSelectedTemplate(null);
        setOutputSettings({
            name: "Sample Template Name",
            resolution: "1080p",
            format: "MP4",
            backgroundMusic: false,
            id: "",
            clipLength: 60,
            keyMoments: [],
            gameType: "basketball"
        });
        setSelectedKeyMoments([]);
    };

    const onChannelChange = ({ detail }: { detail: any }) => {
        setSelectedChannel(detail.selectedOption);
    };

    const handleTemplateChange = ({ detail }: any) => {
        setSelectedTemplate(detail.selectedOption);
    };

    useEffect(() => {
        const options = channels.map((channel: any) => {
            let label = channel.name || channel.id;
            let description = `ID: ${channel.id}`;
            let disabled = false;

            if (channel.provisioningStatus === "CREATING") {
                label = `${label} (Creating...)`;
                disabled = true;
            } else if (channel.provisioningStatus === "FAILED") {
                label = `${label} (Failed)`;
                description = channel.provisioningError || "Channel provisioning failed";
                disabled = true;
            }

            return {
                label,
                value: channel.id,
                description,
                disabled,
            };
        });
        setChannelOptions(options);
        // Auto-select first non-disabled option
        const firstAvailable = options.find((opt: any) => !opt.disabled);
        if (firstAvailable) {
            setSelectedChannel(firstAvailable);
        }
    }, [channels]);

    const loadTemplates = useCallback(async () => {
        try {
            const templates: Template[] = await apiService.getTemplates();
            const options: any = templates.map((template: Template) => ({
                label: template.name,
                value: template.id,
            }));
            setTemplateOptions(options);
        } catch (error) {
            console.error("Failed to load templates:", error);
        }
    }, [apiService]);

    const loadTemplate = useCallback(async () => {
        try {
            if (selectedTemplate) {
                const templateSettings: Template = await apiService.getTemplate(selectedTemplate.value);
                setOutputSettings(templateSettings);
                setSelectedKeyMoments(templateSettings.keyMoments.map((keyMoment: any) => ({
                    label: keyMoment.label,
                    value: keyMoment.value,
                    priority: keyMoment.priority
                })));
            }
        } catch (error) {
            console.error("Failed to load template:", error);
        }
    }, [selectedTemplate, apiService]);

    const loadKeyMoments = useCallback(async () => {
        try {
            // Hardcoded key moments configuration
            // NOTE: Soccer list must be kept in sync with backend priority_map in:
            // api/src/harvest-completion-handler/auto_highlight_generator.py (_get_moment_priority)
            const config = {
                type: {
                    basketball: {
                        label: "Basketball",
                        value: "basketball"
                    },
                    soccer: {
                        label: "Soccer",
                        value: "soccer"
                    },
                },
                keyMoments: {
                    basketball: [
                        { "label": "Dunk", "value": "dunk", "priority": 1 },
                        { "label": "Three-Pointer", "value": "three_pointer", "priority": 2 },
                        { "label": "Block", "value": "block", "priority": 3 }
                    ],
                    soccer: [
                        { "label": "Goal", "value": "goal", "priority": 1 },
                        { "label": "Save", "value": "save", "priority": 2 },
                        { "label": "Celebration", "value": "celebration", "priority": 3 }
                    ]
                }
            };
            setEventTypes(Object.values(config.type));
            setSelectedEventType(config.type.basketball);
            setAllKeyMoments(config.keyMoments);
        } catch (error) {
            console.error("Failed to load key moments:", error);
        }
    }, []);

    const onEventTypeChange = ({ detail }: { detail: any }) => {
        setSelectedEventType(detail.selectedOption);
    };

    useEffect(() => {
        if (selectedEventType) {
            const keyMomentsForSport = allKeyMoments?.[selectedEventType?.value] || [];
            const options: any = keyMomentsForSport.map(({label, value, priority}: {label: string, value: string, priority: number}) => ({
                label:  <div style={{ padding: 4, display: "flex", alignItems: "center", gap: 8 }}>{label}<Badge color={getPriorityColor(priority)}>Priority {priority}</Badge></div>,
                altText: label,
                value,
                priority,
            }));
            setKeyMoments(options);
        }
    }, [allKeyMoments, selectedEventType]);

    useEffect(() => {
        loadKeyMoments().then();
    }, [loadKeyMoments]);

    useEffect(() => {
        loadTemplates().then();
    }, [loadTemplates]);

    useEffect(() => {
        loadTemplate().then();
    }, [loadTemplate]);

    const handleSubmit = async () => {
        try {
            const startDateTime = eventTime.startDate ?? new Date().toISOString();
            const endDateTime = eventTime.endDate ?? new Date().toISOString();
            const duration = new Date(endDateTime).getTime() - new Date(startDateTime).getTime() || "--";
            let templateResponse: any; 

            if (autoGenerateHighlight && saveTemplate === "yes") {
                // Create unified template with auto-generate enabled
                templateResponse = await apiService.createTemplate({
                    ...outputSettings,
                    keyMoments: selectedKeyMoments.map((keyMoment: { label: string, value: string, priority: number, altText: string}) => ({ ...keyMoment, label: keyMoment.altText })),
                    gameType: selectedEventType?.value,
                    autoGenerate: true
                });
            }

            const eventData: CreateEventRequest = {
                name: eventName,
                description,
                startDateTime,
                endDateTime,
                duration,
                mediaLiveChannel: selectedChannel?.value,
                autoGenerateHighlight,
                generateMP4: true,
                highlightTemplateId: templateResponse?.id,
                outputSettings: saveTemplate === "no" ? undefined :{
                    ...outputSettings,
                    gameType: selectedEventType?.value,  // Use selected sport, not state
                    keyMoments: selectedKeyMoments.map((keyMoment: { label: string, value: string}) => keyMoment.value)
                },
                sportsType: selectedEventType?.value
            };

            const createdEvent = await apiService.createEvent(eventData);
            
            // Update template with event ID if we created one for auto-generation
            if (autoGenerateHighlight && saveTemplate === "yes" && createdEvent?.id && templateResponse?.id) {
                try {
                    // Update the template with the event ID
                    await apiService.updateTemplate({
                        ...templateResponse,
                        eventId: createdEvent.id
                    });
                } catch (error) {
                    console.error("Failed to update template with event ID:", error);
                }
            }
            resetForm(); // Reset the form
            // Close dialog and call onSubmit callback
            setShowDialog(false);
            if (onSubmit) {
                onSubmit();
            }
        } catch (error) {
            console.error("Failed to create event:", error);
            // You might want to show an error message to the user here
        }
    };
    return (
        <Modal
            size={"large"}
            header={
                <Header variant="h2" description={"Create and edit your event."}>
                    Create Event
                </Header>
            }
            onDismiss={() => {
                setShowDialog(false);
                resetForm();
            }}
            visible={showDialog}
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="normal" onClick={() => {
                            setShowDialog(false);
                            resetForm();
                            }}
                            ariaLabel="Cancel"
                        >
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleSubmit} ariaLabel="Submit">
                            Submit
                        </Button>
                    </SpaceBetween>
                </Box>
            }
        >
            <Container>
                <form onSubmit={(e) => e.preventDefault()}>
                    <Form>
                        <SpaceBetween size={"l"}>
                            <ColumnLayout columns={2}>
                                <FormField
                                    label="Event Name"
                                    description={
                                        "Add descriptive name that will appear on the event."
                                    }
                                    info={<Link variant="info">Info</Link>}
                                >
                                    <Input
                                        placeholder={"e.g., Key Play, Highlight Moment"}
                                        value={eventName}
                                        onChange={({ detail }) => setEventName(detail.value)}
                                    />
                                </FormField>
                                <FormField
                                    label="Description"
                                    description={"Add a description for the event."}
                                    info={<Link variant="info">Info</Link>}
                                >
                                    <Textarea
                                        rows={2}
                                        onChange={({ detail }) => setDescription(detail.value)}
                                        value={description}
                                        placeholder="Enter a description for your event"
                                    />
                                </FormField>
                                <FormField
                                    label="Media Live Channel"
                                    description={"Select the channel where the event will occur."}
                                    info={<Link variant="info">Info</Link>}
                                >
                                    <Select
                                        options={channelOptions}
                                        onChange={onChannelChange}
                                        selectedOption={selectedChannel}
                                    />
                                </FormField>
                                <FormField
                                    label="Event Type"
                                    description={"Select an event."}
                                    info={<Button variant="inline-icon" iconName="refresh" onClick={loadKeyMoments} ariaLabel="Refresh event types"/>}
                                >
                                    <Select
                                        options={eventTypes}
                                        onChange={onEventTypeChange}
                                        selectedOption={selectedEventType}
                                    />
                                </FormField>
                                
                            </ColumnLayout>
                            <FormField
                                label="Event Time"
                                description={"When the annotation should appear in the clip."}
                                info={<Link variant="info">Info</Link>}
                            >
                                <DateRangePicker
                                    onChange={({ detail }: any) => {
                                        setEventTime(detail.value);
                                        console.log("Event time", detail.value);
                                    }}
                                    value={eventTime}
                                    relativeOptions={[]}
                                    isValidRange={range => {
                                        if (range?.type === "absolute") {
                                            const [
                                                startDateWithoutTime
                                            ] = range.startDate.split("T");
                                            const [
                                                endDateWithoutTime
                                            ] = range.endDate.split("T");
                                        if (
                                            !startDateWithoutTime ||
                                            !endDateWithoutTime
                                        ) {
                                            return {
                                            valid: false,
                                            errorMessage:
                                                "The selected date range is incomplete. Select a start and end date for the date range."
                                            };
                                        }
                                        if (range?.startDate && range?.endDate && 
                                            new Date(range.startDate).getTime() -
                                            new Date(range.endDate).getTime() >
                                            0
                                        ) {
                                            return {
                                            valid: false,
                                            errorMessage:
                                                "The selected date range is invalid. The start date must be before the end date."
                                            };
                                        }
                                        }
                                        return { valid: true };
                                    }}
                                    rangeSelectorMode="absolute-only"
                                    i18nStrings={{
                                        relativeModeTitle: "Relative Time",
                                        absoluteModeTitle: "Absolute",
                                        clearButtonLabel: "Clear and dismiss",
                                        cancelButtonLabel: "Cancel",
                                        applyButtonLabel: "Apply"
                                    }}
                                    hideTimeOffset
                                    absoluteFormat="long-localized"
                                    timeInputFormat="hh:mm"
                                    placeholder="Select a date and time range"
                                />
                            </FormField>
                            {/* <hr style={{ border: "none", height: 1, background: "#eee" }} />
                            <SpaceBetween size={"l"}>
                                <FormField label={"Auto Generate Highlights"}>
                                    <Checkbox
                                        checked={autoGenerateHighlight}
                                        description={
                                            "Highlights will be created when new key moments are identified"
                                        }
                                        onChange={({ detail }) =>
                                            setAutoGenerateHighlight(detail.checked)
                                        }
                                    />
                                    {autoGenerateHighlight && (
                                        <RadioGroup
                                            onChange={({ detail }) => {
                                                setSaveTemplate(detail.value);
                                                setSelectedTemplate(null);
                                            }}
                                            value={saveTemplate}
                                            items={[
                                                {
                                                    value: "no",
                                                    label: (
                                                        <Box variant={"small"}>
                                                            Choose from existing template
                                                        </Box>
                                                    ),
                                                },
                                                {
                                                    value: "yes",
                                                    label: (
                                                        <Box variant={"small"}>
                                                            Create a new template
                                                        </Box>
                                                    ),
                                                },
                                            ]}
                                        />
                                    )}
                                </FormField>
                                {autoGenerateHighlight && (
                                    <SpaceBetween size={"l"}>
                                        {saveTemplate === "no" && (
                                            <FormField
                                                label="Available Templates"
                                                description={
                                                    "Choose a template from the below list"
                                                }
                                                info={<Link variant="info">Info</Link>}
                                            >
                                                <Select
                                                    selectedOption={selectedTemplate}
                                                    options={templateOptions}
                                                    onChange={handleTemplateChange}
                                                />
                                            </FormField>
                                        )}
                                        <Alert>
                                          Below settings are for the <strong>{selectedEventType?.label}</strong> sport.
                                        </Alert>
                                        {(selectedTemplate || saveTemplate == "yes" ) && <><ColumnLayout columns={2}>
                                            <FormField
                                                label="Template Name"
                                                description={"Descriptive name of the template"}
                                                info={<Link variant="info">Info</Link>}
                                            >
                                                <Input
                                                    placeholder={"Enter a name for the template"}
                                                    value={outputSettings?.name ?? ""}
                                                    onChange={({ detail }) =>
                                                        setOutputSettings((prev) => ({
                                                            ...prev,
                                                            name: detail.value,
                                                        }))
                                                    }
                                                    readOnly={!!selectedTemplate}
                                                />
                                            </FormField>
                                            <FormField
                                                label="Output Length (in seconds)"
                                                description={
                                                    "Output length between 15 - 180 seconds."
                                                }
                                            >
                                                <Input
                                                    value={String(outputSettings?.clipLength)}
                                                    inputMode="numeric"
                                                    type="number"
                                                    step={15}
                                                    onChange={({ detail }: any) => {
                                                        if (
                                                            detail.value <= 180 &&
                                                            detail.value >= 15
                                                        )
                                                            setOutputSettings({
                                                                ...outputSettings,
                                                                clipLength: +detail.value,
                                                            });
                                                    }}
                                                    readOnly={!!selectedTemplate}
                                                />
                                            </FormField>
                                            <FormField
                                                label="Output Format"
                                                description={
                                                    "Output format the reel will be available."
                                                }
                                                info={<Link variant="info">Info</Link>}
                                            >
                                                <Badge color={"severity-low"}>{outputSettings?.format}</Badge>
                                            </FormField>
                                            <FormField
                                                label="Output Resolution"
                                                description={
                                                    "Output resolution the reel will be available."
                                                }
                                                info={<Link variant="info">Info</Link>}
                                            >
                                                <Badge>{outputSettings.resolution}</Badge>
                                            </FormField>
                                            <FormField
                                                label="Key Moments"
                                                description={
                                                    "Choose the moments you want to include in the highlight. 1 is the highest priority"
                                                }
                                                info={<Link variant="info">Info</Link>}
                                            >
                                                <Multiselect
                                                    placeholder={"Select all the key moments"}
                                                    options={keyMoments}
                                                    selectedOptions={selectedKeyMoments}
                                                    onChange={({ detail }) =>
                                                        setSelectedKeyMoments(detail.selectedOptions)
                                                    }
                                                    enableSelectAll
                                                    selectedAriaLabel={"Select All"}
                                                    readOnly={!!selectedTemplate}
                                                />
                                            </FormField>
                                            <List
                                                items={selectedKeyMoments}
                                                ariaLabel="Sortable list"
                                                renderItem={(keyMoment: any) => ({
                                                    id: keyMoment.value,
                                                    actions: (
                                                        <ButtonDropdown
                                                            mainAction={{ text: "Change priority" }}
                                                            variant={"icon"}
                                                            onItemClick={({ detail }) => {
                                                                setKeyMoments((prev: any) => {
                                                                    return prev.map((moment: any) => {
                                                                        if (
                                                                            moment.value ===
                                                                            keyMoment.value
                                                                        )
                                                                            moment.priority = detail.id;
                                                                        return moment;
                                                                    });
                                                                });
                                                            }}
                                                            items={[
                                                                {
                                                                    id: "priority",
                                                                    text: "Priority",
                                                                    items: [
                                                                        {
                                                                            text: "1 (Critical)",
                                                                            id: "1",
                                                                            disabled: false,
                                                                        },
                                                                        {
                                                                            text: "2 (High)",
                                                                            id: "2",
                                                                            disabled: false,
                                                                        },
                                                                        {
                                                                            text: "3 (Medium)",
                                                                            id: "3",
                                                                            disabled: false,
                                                                        },
                                                                        {
                                                                            text: "4 (Low)",
                                                                            id: "4",
                                                                            disabled: false,
                                                                        },
                                                                        {
                                                                            text: "5 (Neutral)",
                                                                            id: "5",
                                                                            disabled: false,
                                                                        },
                                                                    ],
                                                                },
                                                            ]}
                                                        >
                                                            <Box
                                                                variant={"small"}
                                                                color={"text-status-info"}
                                                            >
                                                                Priority
                                                            </Box>
                                                        </ButtonDropdown>
                                                    ),
                                                    icon: (
                                                        <Badge
                                                            color={getPriorityColor(+keyMoment.priority)}
                                                        >
                                                            Priority {keyMoment.priority}
                                                        </Badge>
                                                    ),
                                                    content: (
                                                        <Box variant={"h5"} color={"text-status-info"}>
                                                            {keyMoment.altText}{" "}
                                                        </Box>
                                                    ),
                                                })}
                                            />
                                            </ColumnLayout>
                                        </>}
                                    </SpaceBetween>
                                )}
                            </SpaceBetween> */}
                        </SpaceBetween>
                    </Form>
                </form>
            </Container>
        </Modal>
    );
};

export default CreateEvent;
