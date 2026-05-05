import React from "react";
import {
  Modal,
  SpaceBetween,
  FormField,
  Toggle,
  Select,
  Header,
  Box,
  Button,
} from "@cloudscape-design/components";
import { Density } from "@cloudscape-design/global-styles";
import { usePreferences } from "../../../contexts/PreferencesContext";

interface PreferencesModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const densityOptions = [
  { label: "Comfortable", value: Density.Comfortable },
  { label: "Compact", value: Density.Compact },
];

const PreferencesModal: React.FC<PreferencesModalProps> = ({ visible, onDismiss }) => {
  const { darkMode, setDarkMode, density, setDensity, demoMode, setDemoMode } = usePreferences();

  const selectedDensity = densityOptions.find((o) => o.value === density) ?? densityOptions[0];

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={<Header variant="h2">Preferences</Header>}
      size="medium"
      footer={
        <Box float="right">
          <Button variant="link" onClick={onDismiss} ariaLabel="Close">Close</Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <FormField label="Visual mode" description="Choose your preferred visual theme">
          <Toggle checked={darkMode} onChange={({ detail }) => setDarkMode(detail.checked)}>
            Dark mode
          </Toggle>
        </FormField>
        <FormField label="Density" description="Choose the information density">
          <Select
            selectedOption={selectedDensity}
            onChange={({ detail }) => setDensity(detail.selectedOption.value as Density)}
            options={densityOptions}
          />
        </FormField>
        <FormField label="Demo mode" description="Show quick schedule options for faster event creation during demos">
          <Toggle checked={demoMode} onChange={({ detail }) => setDemoMode(detail.checked)}>
            Demo mode
          </Toggle>
        </FormField>
      </SpaceBetween>
    </Modal>
  );
};

export default PreferencesModal;
