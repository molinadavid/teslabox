# TeslaBox
Lite, open-source version of [teslarpi.com](https://www.teslarpi.com).

A cinematic sentry mode (edits clips based on movement), see [here](https://twitter.com/mluggy/status/1628439817460584454) and [here.](https://twitter.com/mluggy/status/1627949202100690945) Also a live-view while you drive and an instant notification/archiving system!

The system alerts you immediately of each sentry/dashcam event (along with a copy of the clip), compresses and uploads to S3.

TeslaBox can also run [TeslaMate.](https://github.com/adriankumpf/teslamate)

<img src="https://cdn.teslarpi.com/assets/img/teslabox.gif" width="150">

## Prerequisites
- Raspberry Pi 4 with at least 4GB ram, at least 64GB of storage and a card reader (<a href="https://s.click.aliexpress.com/e/_DDzWCi3">Like this kit</a>)
- Compatible case with fan (<a href="https://s.click.aliexpress.com/e/_DlGTHll">Like this.</a> Note Argon cases are *not* recommended)
- Some form of WiFi access, preferably in-car (<a href="https://s.click.aliexpress.com/e/_DlY0zpN">Like this 4G USB dongle</a>)
- Extra short, all males <a href="https://s.click.aliexpress.com/e/_DCAMi91">USB-A to USB-C</a> or <a href="https://s.click.aliexpress.com/e/_DBMVYjN">USB-C to USB-C</a> cable

## Optionally:
- [AWS account](https://aws.amazon.com/)
- [Tailscale account](https://tailscale.com/)
- [Telegram account](https://telegram.org/)

## Installation
For paid (priority) support please contact teslabox@payymail.com

### AWS (required for archiving)
1. Sign into your AWS account
2. Create a new S3 bucket:
   - Bucket name: however you'd like (must be globally unique)
   - AWS region: either us-east-1 or the one closest to you
   - ACL Disabled
   - Block *all* public access
   - Bucket versioning: Disable
   - Default encryption: Disable
   - Click "Create Bucket"
3. Add a new IAM user:
   - User name: whatever you'd like (i.e teslabox)
   - Select AWS credential type: Access key: - Programmatic access
   - Click "Next: Permissions"
   - Under "Attach existing policies directly" click "Create Policy"
   - Service: S3
   - Actions: GetObject and PutObject
   - Resource: Add ARN to restrict access
   - Enter your Bucket name from 2.1 and tick "any" on Object name
   - Click "Add"
   - Click "Next: Tags"
   - Click "Next: Review"
   - Name: "teslabox"
   - Click "Create Policy"
   - Back on the IAM user page, refresh the list of policies and check "teslabox"
   - Click "Next: Tags"
   - Click "Next: Review"
   - Click "Create User"
   - Copy both the Access key ID and Secret access key
4. If you want to be notified by email:
   - Edit the policy you just created
   - Click "Add additional permissions"
   - Service: SES v2
   - Actions: SendEmail
   - Identity: Any in this account
   - Click "Review Policy" and "Save Changes"
   - Under SES > Verified identities click "Create Identity"
   - Choose either Domain or Email address with the address(es) you want to notify
   - Verify the identity as per the instructions

### Tailscale (required for remote access)
1. Sign up for a free account
2. Add the device(s) you wish to connect from
3. Under DNS > Enable MagicDNS

### Telegram (required for notifications)
1. Sign into your Telegram account
2. Search and contact [@Botfather](https://telegram.me/BotFather) user
3. Enter /newbot and follow the wizard to create a new bot and retrieve your secret HTTP API token
4. Contact the new bot you just created and click "Start"
5. Search and contact [@getmyid_bot](https://telegram.me/getmyid_bot) user
6. Enter anything to retrieve your Chat ID

### Raspberry Pi
1. Download and run [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Under Operating System, choose Raspberry Pi OS *Lite* (64-bit)
3. Under Storage, choose the SD card you wish to format
4. Under settings:
   - Set hostname to whatever you like (i.e model3.local)
   - Enable SSH and "Use password authentication"
   - Set username (i.e pi) and password to whatever you like
   - Configure wireless LAN, SSID, Password and country. This should be your home WiFi for now
   - Set local settings with your Time zone
   - Check "Eject media when finished"
   - Click SAVE

<img src="https://cdn.teslarpi.com/assets/img/pi_image_settings.png" width="250" hspace="30">

5. Click WRITE and wait for the process to complete and verify
6. Eject the SD card, insert to your Raspberry Pi and boot it up
7. SSH to the hostname you have setup with the credentials you chose (i.e ssh pi@model3.local)
8. Switch to root:
  ```
  sudo -i
  ```
9. Run these commands:
  ```
  echo dtoverlay=dwc2 >> /boot/config.txt
  echo dtoverlay=disable-bt >> /boot/config.txt
  echo hdmi_blanking=2 >> /boot/config.txt
  sed -i 's/fsck.repair=yes/fsck.repair=no/g' /boot/cmdline.txt
  sed -i 's/rootwait/rootwait modules-load=dwc2/g' /boot/cmdline.txt
  ```
10. Add one or more WiFi networks with increasing priority:
  - First, edit your WiFi configuration file:
  ```
  nano /etc/wpa_supplicant/wpa_supplicant.conf
  ```
  - If you want TeslaBox to prefer your home network, then your USB access point, then your mobile hotspot, configuration should be:

  ```
   network={
     ssid="my_home_wifi_name"
     psk="my_home_wifi_password"
     priority=3
     id_str="home"
   }

   network={
     ssid="my_usb_ap_wifi_name"
     psk="my_usb_ap_wifi_password"
     priority=2
     id_str="ap"
   }

   network={
     ssid="my_hotspot_wifi_name"
     psk="my_hotspot_wifi_password"
     priority=1
     id_str="hotspot"
   }
  ```
11. Allocate USB space with all available storage (minus 10GB, or more if you plan on using TeslaMate):
   ```
   size="$(($(df -B1G --output=avail / | tail -1) - 10))"
   fallocate -l "$size"G /usb.bin
   mkdosfs /usb.bin -F 32 -I
   echo "/usb.bin /mnt/usb vfat auto,noexec,nouser,ro,sync 0 0" >> /etc/fstab
   echo "options g_mass_storage file=/usb.bin removable=1 ro=0 stall=0 iSerialNumber=123456" > /etc/modprobe.d/g_mass_storage.conf
   ```
12. Allocate RAM drive with 80% of available memory:
   ```
   echo "tmpfs /mnt/ram tmpfs nodev,nosuid,size=80% 0 0" >> /etc/fstab
   ```
13. Update system packages, upgrade and install required software:
   ```
   curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -
   apt update && apt upgrade -y
   apt install -y nodejs ffmpeg
   sed -i 's/exit 0//g' /etc/rc.local
   echo "/usr/sbin/modprobe g_mass_storage >> /var/log/syslog 2>&1" >> /etc/rc.local
   echo "exit 0" >> /etc/rc.local
   ```
14. Install Tailscale and click the authorize link to add this machine to your network. If you get an error, reboot the box, run ```sudo -i`` and try this step again.
  ```
  curl -fsSL https://tailscale.com/install.sh | sh
  tailscale up
  ```

15. To avoid connectivity issues after running Teslabox for a long time, "Disable key expiry" on each device in your Tailscale network (thanks @genadyo)

16. Download and install TeslaBox and packages:
   ```
   cd /root
   mkdir -p /root/teslabox
   curl -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
   unzip -o main.zip
   cp -r teslabox-main/* teslabox
   rm -rf teslabox-main
   cd teslabox
   npm install --production
   npm prune
   ```
17. Finalize the TeslaBox service:
  - First, create the service file:
  ```
  nano /lib/systemd/system/teslabox.service
  ```
  - Paste this, with each Environment variable appended with its =value (if needed):
  ```
  [Unit]
  Description=TeslaBox
  After=network.target

  [Service]
  Environment="NODE_ENV=production"

  # To enable archive and/or email, enter these
  Environment="AWS_ACCESS_KEY_ID="
  Environment="AWS_SECRET_ACCESS_KEY="
  Environment="AWS_DEFAULT_REGION="
  Environment="AWS_S3_BUCKET="

  # To enable telegram notification, enter this
  Environment="TELEGRAM_ACCESS_TOKEN="

  # If your run other projects, like Tesla Android, change the port number to avoid conflict
  Environment="ADMIN_PORT=80"

  Type=simple
  User=root
  ExecStart=/usr/bin/node /root/teslabox/src/index.js
  Restart=on-failure
  RestartSec=5

  [Install]
  WantedBy=multi-user.target
  ```

  - Install the service to start at every boot as follows:
  ```
  systemctl daemon-reload
  systemctl enable teslabox
  systemctl start teslabox
  systemctl status teslabox
  ```

  If the status is Green and shows active (running), continue to setup.

## Optionally install TeslaMate
1. Install Docker and Docker Compose
   ```
   apt install -y docker docker-compose
   ```
2. Create a docker compose file:
   ```
   nano /root/docker-compose.yml
   ```
3. Paste this, with the environments variables ENCRYPTION_KEY and DATABASE_PASS/POSTGRES_PASSWORD/DATABASE_PASS replaced with actual secrets:
   ```
   version: "3"

   services:
     teslamate:
       image: teslamate/teslamate:latest
       restart: always
       environment:
         - ENCRYPTION_KEY=
         - DATABASE_USER=teslamate
         - DATABASE_PASS=
         - DATABASE_NAME=teslamate
         - DATABASE_HOST=database
         - MQTT_HOST=mosquitto
       ports:
         - 4000:4000
       volumes:
         - ./import:/opt/app/import
       cap_drop:
         - all
       dns:
        - 1.1.1.1
        - 1.0.0.1
        - 8.8.8.8
        - 8.8.4.4
        - 9.9.9.9
        - 149.112.112.112

     database:
       image: postgres:14
       restart: always
       environment:
         - POSTGRES_USER=teslamate
         - POSTGRES_PASSWORD=
         - POSTGRES_DB=teslamate
       volumes:
         - teslamate-db:/var/lib/postgresql/data

     grafana:
       image: teslamate/grafana:latest
       restart: always
       environment:
         - DATABASE_USER=teslamate
         - DATABASE_PASS=
         - DATABASE_NAME=teslamate
         - DATABASE_HOST=database
         - GF_AUTH_ANONYMOUS_ENABLED=true
         - GF_AUTH_ANONYMOUS_ORG_ROLE=Editor
       ports:
         - 3000:3000
       volumes:
         - teslamate-grafana-data:/var/lib/grafana

     mosquitto:
       image: eclipse-mosquitto:2
       restart: always
       command: mosquitto -c /mosquitto-no-auth.conf
       # ports:
       #   - 1883:1883
       volumes:
         - mosquitto-conf:/mosquitto/config
         - mosquitto-data:/mosquitto/data

   volumes:
     teslamate-db:
     teslamate-grafana-data:
     mosquitto-conf:
     mosquitto-data:
   ```
4. Run docker
  ```
  docker-compose up -d
  ```

## Setup

### Initial setup
1. Connect (or Re-connect) TeslaBox to your computer via USB cable and wait for it to appear as drive
2. Create an empty ```TeslaCam``` under the root folder of the drive
3. Make sure TeslaBox is connected to your home network via ethernet cable or home WiFi
4. Browse to the hostname you have setup to change these settings if needed:
- Car name (associates with each upload and notification. Default: My Tesla)
- Log level (log verbosity. Default: Warn)
- Email recipients (comma seperated list of email addresses to notify)
- Telegram recipients (comma seperated list of Telegram Chat IDs to notify)
- Notifications (notifications to send. Low storage to alert when the box has little to no space. Early warning to send an immediate text on each event (~10 seconds). Early warning video to send a short video on each event (~30 seconds). Full video to send the entire video (~10 minutes), with Telegram declining files > 20MB (Default: Low storage & Early warning video)
- Create dashcam clips (uploads and notifies of dashcam/track events. Default: Enabled)
- Quality (the higher you set this, the more space each clip would take. Default: Medium)
- Duration (the longer you set this, the more time and space each clip would take. Default: 45)
- Create sentry clips (uploads and notifies of sentry events. Default: Enabled)
- Cinematic mode (create a single, moving angle view based on simple motion detection. Default: Disabled)
- Quality (the higher you set this, the more space each clip would take. Default: High)
- Duration (the longer you set this, the more time and space each clip would take. Default: 30)
- Ignore angles (do not upload or notify of sentry events from these angles. Note this will reset to default on every run. Default: none)
- Stream (enables streaming. Default: Disabled)
- Copy streams (uploads streams to remote location. Default: Disabled)
- Quality (the higher you set this, the more space each clip would take. Default: High)
- Stream angles (angles to process. Default: front)

### Tailscale setup
1. Under DNS -> Nameservers, note the hostname suffix MagicDNS has generated (something like tailnet-1234.ts.net). Your magic {hostname} is the machine name followed by this suffix (i.e model3.tailnet-1234.ts.net)
2. Under DNS -> Nameservers -> Global nameservers, enable "Override local DNS" and add Google, CloudFlare & Quad9 Public DNS

### TeslaMate setup
1. Configure TeslaMate under http://{hostname}:4000
  - Add an access and refresh token from a secondary Tesla account using 3rd party token generator
  - Set your Home Geo-Fence and charging rate
  - Under settings, set your language/units
  - Under settings, set Web App URL as http://{hostname}:4000 and Dashboards as http://{hostname}:3000 with {hostname} replaced to your magic hostname
2. Access Grafana dashboards through the TeslaMate Web App URL at http://{hostname}:4000
3. Alternatively, setup and configure your dashboards under http://{hostname}:3000

### In-car connectivity
TeslaBox works best with in-car WiFi. I personally use a 4G USB access point plugged into the main console with a short USB-A (female) to USB-C (male) cable. You can also use your mobile WiFi hotspot, or wait for the car to use your home WiFi as you park.

### Admin access
Settings are explained above under Initial setup and always available at: http://{hostname}

## Usage

### Dashcam
Tesla would recognize the TeslaBox as standard USB. You can click save, honk or use voice commands to capture dashcam clips as you would normally. Just make sure the TeslaBox is connected properly and the "Record/ing" has a Red dot on the car quick-settings screen.

If dashcam processing is enabled, clips will be uploaded to S3. If email and/or Telegram has been set up, you'll be notified there with a quick preview and a link to both the event location map and the full video.

The clip would start 0.9X seconds prior to the event ("red dot") and 0.1X seconds following the event. X is settable under *Admin > Dashcam duration*.

### Sentry
If sentry processing is enabled and sentry mode is activated in the car, then similarly to dashcam each event will be uploaded to S3 and notified.

The clip would start 0.4X seconds prior to the event ("red dot") and 0.6X seconds following the event. X is settable under *Admin > Sentry duration*.

The camera that sensed the event first will be enlarged compared to the others.

### Raw footage
Dashcam and sentry videos are always available through the Dashcam app on your Tesla, or by connecting TeslaBox using USB cable to your computer.

### Stream
This is similar to Tesla's Live Sentry, but has no time limit, can stream while driving plus available on any browser. To some extent, you can use it as a security camera.

There is, however, a 1 minute delay for each clip which is the time it takes to close and prepare the file. You can choose what angles to stream and switch between them. Video would automatically progress to the next minute when it is done playing.

If sentry mode is disabled or car is asleep, you may not see any new streams.

You can also request for each stream to automatically upload to S3.

## Important considerations
TeslaBox neither use any Tesla API nor requires any Tesla token. It only replaces your Tesla's standard USB or SSD drive with Micro-SD card on a Raspberry Pi.

You can delete individual (or all) videos under "Safety" or through the Dashcam app on your Tesla, but do **not** format the drive. It will render the TeslaBox useless.

There might be risks involved with running TeslaBox under certain tempature conditions, TeslaBox not recording dashcam or sentry videos and/or TeslaBox not uploading, delivering or notifying you of such events. Always make sure Tesla recognizes a valid USB storage, and that videos are saved and viewable through the built-in Dashcam app.

There might be AWS costs associated with archiving (both storing and viewing clips). See [S3 pricing](https://aws.amazon.com/s3/pricing/).

There might be 3G/4G bandwidth costs associated with your WiFi connectivity. If you are worried you can have TeslaBox connect only to your home or public WiFi.

## Upgrade

1. You can now click "Upgrade" from the Admin console
2. Alternatively, SSH to your Raspberry Pi and run the following to download the latest code, install and restart the service:
   ```
   sh /root/teslabox/upgrade.sh
   ```

## License
TeslaBox is for PRIVATE, NON-COMMERCIAL, NON-GOVERNMENTAL USE ONLY!

## Support
TeslaBox is not affiliated or supported by Tesla. There is no official support whatsoever. As per the license this is provided As-Is. **Use at your own risk!**

Please open an issue if things seems out of order and I'll attend them as time allows.

## Credits
TeslaBox wouldn't be possible without the help of [teslausb](https://github.com/marcone/teslausb), [tesla_dashcam](https://github.com/ehendrix23/tesla_dashcam) and friends at [TeslaFansIL](https://t.me/TeslaFansIL).
