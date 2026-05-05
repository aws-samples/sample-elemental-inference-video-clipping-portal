import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Form,
  FormField,
  Input,
  Modal,
  Select,
  SpaceBetween,
  Spinner,
  StatusIndicator,
} from "@cloudscape-design/components";
import ApiService from "../../../services/apiService";
import { STANDARD_ENCODER_SETTINGS } from "../../../config/encoderSettings";
import type { ChannelFormState, ChannelFormValidationErrors } from "../../../types/channels";

interface CreateChannelModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

const INPUT_TYPE_OPTIONS = [
  { label: "MP4 File", value: "MP4_FILE" },
];

const NAME_PATTERN = /^[a-zA-Z0-9\-_]+$/;

const INITIAL_FORM_STATE: ChannelFormState = {
  channelName: "",
  inputType: { label: "MP4 File", value: "MP4_FILE" },
  inputUrl: "",
  inputName: "",
};

const POLL_INTERVAL_MS = 4000;

const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  visible,
  onDismiss,
  onSuccess,
}) => {
  const apiService = ApiService.getInstance();
  const [formData, setFormData] = useState<ChannelFormState>(INITIAL_FORM_STATE);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ChannelFormValidationErrors>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executionArnRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    executionArnRef.current = null;
  }, []);

  // Cleanup polling on unmount or when modal closes
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    if (!visible) {
      stopPolling();
    }
  }, [visible, stopPolling]);

  const resetForm = () => {
    setFormData(INITIAL_FORM_STATE);
    setError(null);
    setValidationErrors({});
    setLoading(false);
    setCreating(false);
    stopPolling();
  };

  const validateForm = (): boolean => {
    const errors: ChannelFormValidationErrors = {};

    if (!formData.channelName.trim()) {
      errors.channelName = "Channel name is required";
    } else if (formData.channelName.length > 255) {
      errors.channelName = "Channel name must be 255 characters or fewer";
    } else if (!NAME_PATTERN.test(formData.channelName)) {
      errors.channelName = "Channel name must contain only letters, numbers, hyphens, and underscores";
    }

    if (!formData.inputUrl.trim()) {
      errors.inputUrl = "Input URL is required";
    } else if (!formData.inputUrl.startsWith("s3://")) {
      errors.inputUrl = "Input URL must start with s3://";
    }

    if (!formData.inputName.trim()) {
      errors.inputName = "Input name is required";
    } else if (formData.inputName.length > 255) {
      errors.inputName = "Input name must be 255 characters or fewer";
    } else if (!NAME_PATTERN.test(formData.inputName)) {
      errors.inputName = "Input name must contain only letters, numbers, hyphens, and underscores";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isFormValid = (): boolean => {
    return (
      formData.channelName.trim() !== "" &&
      formData.inputUrl.trim() !== "" &&
      formData.inputUrl.startsWith("s3://") &&
      formData.inputName.trim() !== "" &&
      NAME_PATTERN.test(formData.channelName) &&
      NAME_PATTERN.test(formData.inputName)
    );
  };

  const pollCreationStatus = useCallback((executionArn: string) => {
    executionArnRef.current = executionArn;

    pollingRef.current = setInterval(async () => {
      try {
        const statusResponse = await apiService.getChannelCreationStatus(executionArn);

        if (statusResponse.status === "ACTIVE") {
          stopPolling();
          setCreating(false);
          setLoading(false);
          resetForm();
          onDismiss();
          onSuccess();
        } else if (statusResponse.status === "FAILED" || statusResponse.status === "TIMED_OUT" || statusResponse.status === "ABORTED") {
          stopPolling();
          setCreating(false);
          setLoading(false);
          const rawError = statusResponse.error;
          let errorMessage: string;
          if (typeof rawError === 'string') {
            errorMessage = rawError;
          } else if (rawError && typeof rawError === 'object') {
            errorMessage = (rawError as any).cause || (rawError as any).error || `Channel creation ${statusResponse.status.toLowerCase()}`;
          } else {
            errorMessage = `Channel creation ${statusResponse.status.toLowerCase()}`;
          }
          setError(errorMessage);
        }
        // For RUNNING status, continue polling
      } catch (err: any) {
        stopPolling();
        setCreating(false);
        setLoading(false);
        setError("Failed to check channel creation status. Please check the channel list.");
      }
    }, POLL_INTERVAL_MS);
  }, [apiService, stopPolling, onDismiss, onSuccess]);

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setCreating(false);
    setError(null);

    try {
      const response = await apiService.createChannel({
        channelName: formData.channelName,
        inputType: formData.inputType.value,
        inputUrl: formData.inputUrl,
        inputName: formData.inputName,
        encoderSettings: STANDARD_ENCODER_SETTINGS,
      });

      if (response?.executionArn) {
        setCreating(true);
        pollCreationStatus(response.executionArn);
      } else {
        // Fallback for unexpected response format
        setLoading(false);
        resetForm();
        onDismiss();
        onSuccess();
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        "An unexpected error occurred during channel creation";
      setError(message);
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onDismiss();
  };

  const isInProgress = loading || creating;

  return (
    <Modal
      visible={visible}
      onDismiss={handleCancel}
      header="Create Channel"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleCancel} disabled={isInProgress} ariaLabel="Cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={loading && !creating}
              disabled={!isFormValid() || isInProgress}
              ariaLabel="Create"
            >
              Create
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form>
        <SpaceBetween size="l">
          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {creating && (
            <Alert type="info">
              <SpaceBetween direction="horizontal" size="xs">
                <Spinner size="normal" />
                <StatusIndicator type="in-progress">
                  Creating channel — provisioning AWS resources. This may take a minute...
                </StatusIndicator>
              </SpaceBetween>
            </Alert>
          )}

          <FormField
            label="Channel Name"
            description="A unique name for the MediaLive channel"
            errorText={validationErrors.channelName}
          >
            <Input
              value={formData.channelName}
              onChange={({ detail }) => {
                setFormData((prev) => ({ ...prev, channelName: detail.value }));
                if (validationErrors.channelName) {
                  setValidationErrors((prev) => ({ ...prev, channelName: undefined }));
                }
              }}
              placeholder="my-channel"
              disabled={isInProgress}
            />
          </FormField>

          <FormField
            label="Input Type"
            description="The type of video input source"
          >
            <Select
              selectedOption={formData.inputType}
              onChange={({ detail }) =>
                setFormData((prev) => ({
                  ...prev,
                  inputType: detail.selectedOption as ChannelFormState["inputType"],
                }))
              }
              options={INPUT_TYPE_OPTIONS}
              disabled={isInProgress}
            />
          </FormField>

          <FormField
            label="Input URL"
            description="S3 URL for the video input source"
            errorText={validationErrors.inputUrl}
          >
            <Input
              value={formData.inputUrl}
              onChange={({ detail }) => {
                setFormData((prev) => ({ ...prev, inputUrl: detail.value }));
                if (validationErrors.inputUrl) {
                  setValidationErrors((prev) => ({ ...prev, inputUrl: undefined }));
                }
              }}
              placeholder="s3://bucket-name/path/to/video.mp4"
              disabled={isInProgress}
            />
          </FormField>

          <FormField
            label="Input Name"
            description="A name for the MediaLive input"
            errorText={validationErrors.inputName}
          >
            <Input
              value={formData.inputName}
              onChange={({ detail }) => {
                setFormData((prev) => ({ ...prev, inputName: detail.value }));
                if (validationErrors.inputName) {
                  setValidationErrors((prev) => ({ ...prev, inputName: undefined }));
                }
              }}
              placeholder="my-input"
              disabled={isInProgress}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
};

export default CreateChannelModal;
