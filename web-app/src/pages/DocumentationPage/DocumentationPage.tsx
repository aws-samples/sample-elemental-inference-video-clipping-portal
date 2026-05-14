import React, { useState } from "react";
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
  SideNavigation,
  Grid,
  Box,
  ExpandableSection,
} from "@cloudscape-design/components";

const sections = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: (
      <SpaceBetween size="m">
        <Box variant="p">
          AWS Elemental Inference Clipping &amp; Cropping is a web-based tool for capturing, editing, and exporting video clips from live and recorded streams. This guide walks you through each feature in the order you will typically use them.
        </Box>
        <Box variant="h4">Workflow Overview</Box>
        <Box variant="p">
          The typical workflow follows these steps:
        </Box>
        <ol>
          <li>Create one or more <strong>Channels</strong> to connect to your video sources.</li>
          <li>Create <strong>Events</strong> to organize your clipping sessions.</li>
          <li>Create <strong>Clips</strong> manually or use <strong>Auto-Harvesting</strong> to capture highlights automatically.</li>
          <li><strong>Prepare</strong> clips by selecting in/out points and cropping regions.</li>
          <li><strong>Edit</strong> clips in the Video Editor for fine-tuning.</li>
          <li><strong>Download</strong> finished clips to your local machine.</li>
        </ol>
      </SpaceBetween>
    ),
  },
  {
    id: "channels",
    title: "Channels",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">What is a Channel?</Box>
        <Box variant="p">
          A Channel represents a connection to a video source such as a live stream or a MediaLive channel. Channels must be created before you can capture clips.
        </Box>
        <ExpandableSection headerText="Creating a Channel">
          <SpaceBetween size="s">
            <Box variant="p">1. Navigate to the <strong>Channels</strong> page from the side navigation.</Box>
            <Box variant="p">2. Click the <strong>Create Channel</strong> button.</Box>
            <Box variant="p">3. Enter a name and configure the channel source settings.</Box>
            <Box variant="p">4. Click <strong>Create</strong> to provision the channel. The status will show as "Creating" while the channel is being set up.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Managing Channels">
          <SpaceBetween size="s">
            <Box variant="p">From the Channels page you can:</Box>
            <ul>
              <li><strong>Start / Stop</strong> a channel to control the live input.</li>
              <li><strong>View status</strong> — channels show real-time state indicators (Running, Idle, Creating, etc.).</li>
              <li><strong>Delete</strong> a channel when it is no longer needed.</li>
            </ul>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "events",
    title: "Events",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">What is an Event?</Box>
        <Box variant="p">
          Events are containers that group related clips together. Think of an event as a game, show, or broadcast session that you want to clip from.
        </Box>
        <ExpandableSection headerText="Creating an Event">
          <SpaceBetween size="s">
            <Box variant="p">1. On the <strong>Home</strong> page, click <strong>Create Event</strong>.</Box>
            <Box variant="p">2. Provide a name and select the channel(s) to associate with the event.</Box>
            <Box variant="p">3. Optionally set a scheduled start time.</Box>
            <Box variant="p">4. Click <strong>Create</strong> to save the event.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Managing Events">
          <SpaceBetween size="s">
            <Box variant="p">From the Home page you can:</Box>
            <ul>
              <li><strong>Select an event</strong> to view its associated clips.</li>
              <li><strong>Delete events</strong> individually or in bulk. You will be prompted to optionally delete associated clips.</li>
            </ul>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "clip-creation",
    title: "Clip Creation",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Creating Clips</Box>
        <Box variant="p">
          Clips are short video segments extracted from a channel's stream. You can create clips manually or let the system generate them automatically.
        </Box>
        <ExpandableSection headerText="Manual Clip Creation">
          <SpaceBetween size="s">
            <Box variant="p">1. Select an event from the Home page to view its clips.</Box>
            <Box variant="p">2. Click <strong>Create Clip</strong>.</Box>
            <Box variant="p">3. Choose the source channel and set the desired time range.</Box>
            <Box variant="p">4. Click <strong>Create</strong> to begin clip extraction.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Clip States">
          <SpaceBetween size="s">
            <Box variant="p">Clips progress through several states:</Box>
            <ul>
              <li><strong>Pending</strong> — clip has been requested and is queued for processing.</li>
              <li><strong>Processing</strong> — the clip is being extracted from the stream.</li>
              <li><strong>Ready</strong> — the clip is available for preview, editing, and download.</li>
              <li><strong>Error</strong> — something went wrong during extraction.</li>
            </ul>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "auto-harvesting",
    title: "Auto-Harvesting",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Automatic Clip Harvesting</Box>
        <Box variant="p">
          Auto-Harvesting uses automated pipelines to detect key moments in a live stream and create clips without manual intervention.
        </Box>
        <ExpandableSection headerText="How It Works">
          <SpaceBetween size="s">
            <Box variant="p">1. When an event is active and a channel is running, the harvest pipeline monitors the stream.</Box>
            <Box variant="p">2. Key moments are detected based on configured rules and thresholds.</Box>
            <Box variant="p">3. Clips are automatically created and associated with the event.</Box>
            <Box variant="p">4. Harvested clips appear in the clips list with the same states as manual clips.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Managing Harvests">
          <SpaceBetween size="s">
            <Box variant="p">You can monitor and manage auto-harvesting from the event detail view. Harvested clips can be edited and downloaded just like manually created clips.</Box>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "clip-preparation",
    title: "Clip Preparation",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Preparing Clips</Box>
        <Box variant="p">
          Before a clip is ready for final export, you may want to refine it by adjusting the in/out points and selecting a crop region.
        </Box>
        <ExpandableSection headerText="Setting In/Out Points">
          <SpaceBetween size="s">
            <Box variant="p">1. Open a clip by clicking on it in the clips list.</Box>
            <Box variant="p">2. Use the video player timeline to scrub to the desired start point and click <strong>Set In</strong>.</Box>
            <Box variant="p">3. Scrub to the desired end point and click <strong>Set Out</strong>.</Box>
            <Box variant="p">4. The clip duration updates automatically based on your selection.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Cropping">
          <SpaceBetween size="s">
            <Box variant="p">Use the crop overlay on the video preview to select the region of the frame you want to keep. This is useful for creating vertical or square crops from widescreen sources.</Box>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "clip-editing",
    title: "Clip Editing",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Video Editor</Box>
        <Box variant="p">
          The Video Editor provides advanced editing capabilities for fine-tuning your clips.
        </Box>
        <ExpandableSection headerText="Opening the Editor">
          <SpaceBetween size="s">
            <Box variant="p">1. Select a clip and choose <strong>Edit in Video Editor</strong>, or navigate to the <strong>Video Editor</strong> page from the side navigation.</Box>
            <Box variant="p">2. The editor loads the clip with a dual-player preview showing the original and edited versions side by side.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Editor Features">
          <SpaceBetween size="s">
            <ul>
              <li><strong>Timeline scrubbing</strong> — navigate frame-by-frame through the clip.</li>
              <li><strong>Crop adjustment</strong> — refine the crop region with pixel-level precision.</li>
              <li><strong>Preview</strong> — play back the edited clip in real time before exporting.</li>
            </ul>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "downloading",
    title: "Downloading Clips",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Downloading Locally</Box>
        <Box variant="p">
          Once a clip is ready, you can download it to your local machine.
        </Box>
        <ExpandableSection headerText="How to Download">
          <SpaceBetween size="s">
            <Box variant="p">1. Open the clip detail view by clicking on a clip.</Box>
            <Box variant="p">2. Click the <strong>Download</strong> button.</Box>
            <Box variant="p">3. The clip will be downloaded in its processed format to your browser's default download location.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Bulk Downloads">
          <SpaceBetween size="s">
            <Box variant="p">You can select multiple clips from the clips list and use the bulk download action to download them all at once.</Box>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "preferences",
    title: "User Preferences",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">Preferences</Box>
        <Box variant="p">
          User Preferences are client-side settings that customize the application display for your browser. They are stored locally and do not affect other users.
        </Box>
        <ExpandableSection headerText="Accessing Preferences">
          <SpaceBetween size="s">
            <Box variant="p">Click your username in the top navigation bar and select <strong>Preferences</strong> from the dropdown menu.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Available Preferences">
          <SpaceBetween size="s">
            <ul>
              <li><strong>Dark mode</strong> — toggle between light and dark visual themes.</li>
              <li><strong>Density</strong> — choose between Comfortable (more spacing) or Compact (denser layout) display modes.</li>
              <li><strong>Demo mode</strong> — enables quick-schedule options during event creation for faster demonstrations.</li>
            </ul>
            <Box variant="p">Preferences persist across browser sessions but are not synced between devices.</Box>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
  {
    id: "settings",
    title: "System Settings",
    content: (
      <SpaceBetween size="m">
        <Box variant="h4">System Settings</Box>
        <Box variant="p">
          System Settings control application-wide configuration that affects all users. These settings are stored server-side in DynamoDB.
        </Box>
        <ExpandableSection headerText="Accessing System Settings">
          <SpaceBetween size="s">
            <Box variant="p">Click your username in the top navigation bar and select <strong>System Settings</strong> from the dropdown menu.</Box>
          </SpaceBetween>
        </ExpandableSection>
        <ExpandableSection headerText="Available Settings">
          <SpaceBetween size="s">
            <ul>
              <li><strong>Auto-Harvest</strong> — when enabled, both landscape and portrait orientations are automatically harvested when highlights are detected.</li>
              <li><strong>Harvest Buffer (seconds)</strong> — additional seconds of content added before and after each harvested clip (0–5). Useful for editing flexibility.</li>
              <li><strong>Harvest Retention (days)</strong> — number of days to retain harvested clip content in S3 before automatic cleanup (1–365, default 30).</li>
              <li><strong>Auto-Activate Inference</strong> — when enabled, events are automatically activated and deactivated for inference based on their scheduled start and end times.</li>
              <li><strong>Conflict Resolution</strong> — choose how overlapping events on the same channel are handled: prefer running events or prefer the event with the latest start time.</li>
            </ul>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    ),
  },
];

const DocumentationPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState("getting-started");

  const navItems = sections.map((s) => ({
    type: "link" as const,
    text: s.title,
    href: `#${s.id}`,
  }));

  const handleNavFollow = (event: CustomEvent) => {
    event.preventDefault();
    const id = event.detail.href?.replace("#", "");
    if (id) {
      setActiveSection(id);
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <ContentLayout
      defaultPadding
      headerVariant="high-contrast"
      header={
        <Header
          variant="h1"
          description="User guide for AWS Elemental Inference Clipping & Cropping"
        >
          Documentation
        </Header>
      }
    >
        <Grid gridDefinition={[{ colspan: 3 }, { colspan: 9 }]}>
          <div style={{ position: "sticky", top: "1em" }}>
          <SideNavigation
            header={{ text: "Contents", href: "#" }}
            activeHref={`#${activeSection}`}
            onFollow={handleNavFollow}
            items={navItems}
          />
        </div>
        <SpaceBetween size="l">
          {sections.map((section) => (
            <div key={section.id} id={section.id} style={{ scrollMarginTop: "11em" }}>
              <Container header={<Header variant="h2">{section.title}</Header>}>
                {section.content}
              </Container>
            </div>
          ))}
        </SpaceBetween>
        </Grid>
      </ContentLayout>
  );
};

export default DocumentationPage;
