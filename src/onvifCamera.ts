import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import {
  DeviceInformation,
  NotificationMessage,
  // Cam as ICam,
} from "./types/onvif";
// @ts-expect-error no typings available
import { Cam } from "onvif";
import { EventEmitter } from "stream";

export class OnvifCamera {
  private events: EventEmitter | undefined;
  private device: Cam | undefined;

  private readonly kOnvifPort = 2020;

  constructor(
    protected readonly log: Logging,
    protected readonly config: CameraConfig,
  ) {}

  private async getDevice(): Promise<Cam> {
    return new Promise((resolve, reject) => {
      if (this.device) {
        return resolve(this.device);
      }

      const device: Cam = new Cam(
        {
          hostname: this.config.ipAddress,
          username: this.config.streamUser,
          password: this.config.streamPassword,
          port: this.kOnvifPort,
        },
        (err: Error) => {
          if (err) return reject(err);
          this.device = device;
          return resolve(this.device);
        },
      );
    });
  }

  async getEventEmitter() {
    if (this.events) {
      return this.events;
    }

    const onvifDevice = await this.getDevice();

    let lastMotionValue = false;

    this.events = new EventEmitter();
    this.log.debug("Starting ONVIF listener...");

    onvifDevice.on("event", (event: NotificationMessage) => {
      this.log.info("ONVIF event", event);
      if (event?.topic?._?.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
        const motion = event.message.message.data.simpleItem.$.Value;
        if (motion !== lastMotionValue) {
          lastMotionValue = Boolean(motion);
          this.events = this.events || new EventEmitter();
          this.events.emit("motion", motion);
        }
      }
    });

    return this.events;
  }

  async getDeviceInfo(): Promise<DeviceInformation> {
    const onvifDevice = await this.getDevice();
    return new Promise((resolve, reject) => {
      onvifDevice.getDeviceInformation(
        (err: unknown, deviceInformation: DeviceInformation) => {
          if (err) return reject(err);
          resolve(deviceInformation);
        },
      );
    });
  }
  // PTZ
  private readonly STEP_SIZE = 0.1; // Define a fixed step size
  private readonly STEP_DURATION = 250; // Duration in milliseconds for each step

  async panCamera(direction: "left" | "right") {
    const onvifDevice = await this.getDevice();
    const panSpeed = direction === "left" ? -this.STEP_SIZE : this.STEP_SIZE;
    this.log.debug(`Panning camera ${direction} with speed ${panSpeed}`);
    onvifDevice.continuousMove(
      {
        x: panSpeed,
        y: 0,
        zoom: 0,
      },
      (err: unknown) => {
        if (err) {
          this.log.error("Failed to pan camera:", err);
          return;
        }
        setTimeout(() => {
          onvifDevice.stop((stopErr: unknown) => {
            if (stopErr) {
              this.log.error("Failed to stop camera movement:", stopErr);
            }
          });
        }, this.STEP_DURATION);
      },
    );
  }

  async tiltCamera(direction: "up" | "down") {
    const onvifDevice = await this.getDevice();
    const tiltSpeed = direction === "up" ? this.STEP_SIZE : -this.STEP_SIZE;
    this.log.debug(`Tilting camera ${direction} with speed ${tiltSpeed}`);
    onvifDevice.continuousMove(
      {
        x: 0,
        y: tiltSpeed,
        zoom: 0,
      },
      (err: unknown) => {
        if (err) {
          this.log.error("Failed to tilt camera:", err);
          return;
        }
        setTimeout(() => {
          onvifDevice.stop((stopErr: unknown) => {
            if (stopErr) {
              this.log.error("Failed to stop camera movement:", stopErr);
            }
          });
        }, this.STEP_DURATION);
      },
    );
  }
}
