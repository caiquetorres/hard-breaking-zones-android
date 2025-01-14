import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Position } from '@capacitor/geolocation';
import { Acceleration } from '@capacitor/motion';

import { IPoint } from '../../models/interfaces/point.interface';
import { IVersion } from '../../models/proxies/version.interface';

import { AlertService } from '../../services/alert/alert.service';
import { BrowserService } from '../../services/browser/browser.service';
import { DeviceService } from '../../services/device/device.service';
import { GeolocationService } from '../../services/geolocation/geolocation.service';
import { KeepAwakeService } from '../../services/keep-awake/keep-awake.service';
import { MotionService } from '../../services/motion/motion.service';
import { PointService } from '../../services/point/point.service';
import { VersionService } from '../../services/version/version.service';

import { environment } from '../../../environments/environment';

import {
  Chart,
  registerables,
  ChartConfiguration,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
} from 'chart.js';

Chart.register(...registerables);
Chart.register(LineController, LineElement, PointElement, LinearScale, Title);

/**
 * Component that represents the application home page.
 *
 * @example
 * ```html
 * <hbz-home></hbz-home>
 * ```
 */
@Component({
  selector: 'hbz-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit, AfterViewInit {
  /**
   * Property that defines an object that represents the page canvas.
   */
  @ViewChild('canvasRef')
  canvasRef: ElementRef<HTMLCanvasElement>;

  /**
   * Property that says if the user is collecting the data or not.
   */
  @HostBinding('class.tracking')
  tracking = false;

  /**
   * Property that defines the trip duration.
   */
  travelDuration = 0;

  /**
   * Property that defines an object that contanis all the device
   * position data.
   */
  position: Position;

  /**
   * Property that defines an object that contains all the device
   * acceleration data.
   */
  acceleration: Acceleration;

  /**
   * Property that defines the maximum travel duration.
   */
  readonly maxTravelDuration: number;

  /**
   * Property that defines the current amount of data present in
   * the chart.
   */
  private counter = 0;

  /**
   * Property that defines the device unique identifier.
   */
  private deviceId: string;

  /**
   * Property that defines an object that represents the current
   * chart, that is displaying the acceleration data.
   */
  private chart: Chart;

  /**
   * Property that defines an object that represents the second
   * interval, used to track the trip duration.
   */
  private travelDurationInterval: ReturnType<typeof setInterval>;

  /**
   * Property that defines an object that contains all the
   * acceleration chart data.
   */
  private readonly chartOptions: ChartConfiguration = {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          fill: false,
          borderColor: 'red',
          pointRadius: 0,
        },
        {
          data: [],
          fill: false,
          borderColor: 'green',
          pointRadius: 0,
        },
        {
          data: [],
          fill: false,
          borderColor: 'blue',
          pointRadius: 0,
        },
      ],
    },
    options: {
      scales: {
        xAxis: {
          display: false,
          suggestedMin: 100,
        },
        yAxis: {
          suggestedMin: -20,
          suggestedMax: 20,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
      },
    },
  };

  constructor(
    private readonly keepAwakeService: KeepAwakeService,
    private readonly geolocationService: GeolocationService,
    private readonly motionService: MotionService,
    private readonly deviceService: DeviceService,
    private readonly versionService: VersionService,
    private readonly alertService: AlertService,
    private readonly browserService: BrowserService,
    private readonly pointService: PointService,
  ) {
    this.maxTravelDuration = environment.constants.maxTripDurationInMinutes;
  }

  async ngOnInit() {
    setInterval(() => {
      this.createPoint();
      this.updateChart();

      if (this.travelDuration / 60 >= this.maxTravelDuration) {
        this.toggleTracking();
      }

      if (!this.tracking) {
        return;
      }

      this.savePoint();
    }, environment.constants.getPointInterval);

    const version = await this.fetchVersion();

    if (version.value.version !== environment.version) {
      await this.showVersionAlert(version);
    }
  }

  ngAfterViewInit() {
    this.chart = new Chart(this.canvasRef.nativeElement, this.chartOptions);
  }

  /**
   * Method that starts or stops the application of tracking the
   * user acceleration, position and id.
   */
  async toggleTracking() {
    this.tracking = !this.tracking;

    if (this.tracking) {
      this.travelDurationInterval = setInterval(
        () => this.travelDuration++,
        1000,
      );
      await this.keepAwakeService.keepAwake();
    } else {
      this.travelDuration = 0;
      clearInterval(this.travelDurationInterval);
      await this.keepAwakeService.allowSleep();
    }
  }

  /**
   * Method that gets the difference in minutes between two dates.
   *
   * @param startDate defines the first date.
   * @param endDate defines the second date.
   * @returns the difference between the two dates in minutes.
   */
  getMinutesBetweenDates(startDate: Date, endDate: Date) {
    const diff = endDate.getTime() - startDate.getTime();
    return diff / 60000;
  }

  /**
   * Method that creates a new point, allowing to see it data in
   * the page and saving it later.
   */
  private async createPoint() {
    this.acceleration = this.getAcceleration();
    this.position = await this.getPosition();
    this.deviceId ??= await this.getDeviceId();
  }

  /**
   * Method that updates the chart view.
   */
  private updateChart() {
    if (!this.chart || !this.acceleration) {
      return;
    }

    if (this.chart.data.labels.length > 20) {
      this.chart.data.labels.shift();
      this.chart.data.datasets.forEach((dataset) => dataset.data.shift());

      this.chart.update();
    }

    this.chart.data.labels.push(this.counter++);

    this.chart.data.datasets[0].data.push(this.acceleration.x);
    this.chart.data.datasets[1].data.push(this.acceleration.y);
    this.chart.data.datasets[2].data.push(this.acceleration.z);

    this.chart.update();
  }

  /**
   * Method that saves a new point based on the user's position
   * and acceleration.
   */
  private async savePoint() {
    const point: IPoint = {
      latitude: `${this.position.coords.latitude}`,
      longitude: `${this.position.coords.longitude}`,
      speed: +this.position.coords.speed.toFixed(4),
      accuracy: +this.position.coords.speed.toFixed(4),
      acclX: +this.acceleration.x.toFixed(4),
      acclY: +this.acceleration.y.toFixed(4),
      acclZ: +this.acceleration.z.toFixed(4),
      deviceId: this.deviceId,
      timestamp: new Date().getTime(),
    };

    await this.pointService.save(point);
  }

  /**
   * Method that shows the application `alert`.
   */
  private async showVersionAlert(version: IVersion) {
    await this.alertService.present({
      header: 'Nova versão',
      message: `Uma nova versão do app foi encontrada, deseja baixa-la?`,
      buttons: [
        'Cancelar',
        {
          text: 'Fazer download',
          handler: async () => {
            await this.browserService.open(version.value.url);
          },
        },
      ],
    });
  }

  /**
   * Method that gets the user's current acceleration.
   *
   * @returns an object that contains all the acceleration data.
   */
  private getAcceleration() {
    return this.motionService.getCurrentAcceleration();
  }

  /**
   * Method that gets the user's current position.
   *
   * @returns an object that contains all the position daat.
   */
  private getPosition() {
    return this.geolocationService.getCurrentPosition();
  }

  /**
   * Method that gets the device id.
   *
   * @returns an string that represents the device id.
   */
  private getDeviceId() {
    return this.deviceService.getId();
  }

  /**
   * Method that gets from the backend the default entity value.
   *
   * @returns an object that represents the found entity.
   */
  private fetchVersion() {
    return this.versionService.getOne();
  }
}
