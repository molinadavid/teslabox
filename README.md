# TeslaBox
Lite, open-source version of [teslarpi.com](https://www.teslarpi.com).

Compresses Tesla dashcam and sentry clips, uploads to S3, notifies of events (along with a copy of each clip) via Telegram and allows remote streaming while parked or driving!

Can also turn your Tesla to a surveillance/security camera, granting access to anyone with a browser.

![](https://cdn.teslarpi.com/assets/img/teslabox.gif)

## Prerequisites
- Raspberry Pi 4 with at least 4GB of ram
- Compatible case (Argon cases are *not* recommended)
- Compatible heat sinks and fan (3V prefered)
- Micro-SD card with at least 64GB of storage and card reader
- USB-A to USB-C or USB-C to USB-C (all males) cable
- Some form of WiFi access (preferably in-car)

## Optionally:
- [AWS account](https://aws.amazon.com/)
- [Ngrok account](https://ngrok.com/) (preferably paid)
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

### Ngrok (required for remote access)
1. Sign into your Ngrok account
2. Retrieve your secret token under *Getting Started > Your Authtoken*
3. On paid plans, create your custom domain (you.example.com) or subdomain (you.ngrok.io)

### Telegram (required for notifications)
1. Sign into your Telegram account
2. Search and contact [@Botfather](https://telegram.me/BotFather) user
3. Enter /newbot and follow the wizard to create a new bot and retrieve your secret HTTP API token
4. Contact the new bot you just created and click "Start"
5. Search and contact [@get_id_bot](https://telegram.me/get_id_bot) user
6. Enter anything to retrieve your Chat ID

### Raspberry Pi
1. Download and run [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Under Operating System, choose Raspberry Pi OS *Lite* (64-bit)
3. Under Storage, choose the SD card you wish to format
4. Under settings:
   4.1. Set hostname to whatever you like (i.e teslabox.local)
   4.2. Enable SSH and "Use password authentication"
   4.3. Set username (i.e pi) and password to whatever you like
   4.4. Configure wireless LAN, SSID, Password and country. This should be your home WiFi for now
   4.5. Set local settings with your Time zone
   4.6. Check "Eject media when finished"
   4.7. Click SAVE
   ![](https://cdn.teslarpi.com/assets/img/pi_imager_settings.png)
5. Click WRITE and wait for the process to complete and verify
6. Eject the SD card, insert to your Raspberry Pi and boot it up
7. SSH to the hostname from 4.1 using credentials from 4.3 (i.e ssh pi@teslabox.local)
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
  10.1. First, edit your WiFi configuration file:
  ```
  nano /etc/wpa_supplicant/wpa_supplicant.conf
  ```

  10.2. If you want TeslaBox to prefer your home network, then your USB access point, then your mobile hotspot,  configuration should be:

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
11. Allocate USB space with all available storage (minus 8GB):
   ```
   size="$(($(df -B1G --output=avail / | tail -1) - 8))"
   fallocate -l "$size"G /usb.bin
   mkdosfs /usb.bin -F 32 -I
   echo "/usb.bin /mnt/usb vfat defaults 0 0" >> /etc/fstab
   echo "options g_mass_storage file=/usb.bin removable=1 ro=0 stall=0 iSerialNumber=123456" > /etc/modprobe.d/g_mass_storage.conf
   ```
12. Update system packages, upgrade and install required software:
   ```
   curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -
   apt update && apt upgrade -y
   apt install -y nodejs python3-pip ffmpeg fonts-freefont-ttf
   pip install tesla_dashcam
   sed -i 's/exit 0//g' /etc/rc.local
   echo "/usr/sbin/modprobe g_mass_storage >> /var/log/teslabox.log 2>&1" >> /etc/rc.local
   echo "exit 0" >> /etc/rc.local
   ```
13. Download and install TeslaBox and packages:
   ```
   cd /root
   mkdir -p /root/teslabox
   curl -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
   unzip -o main.zip
   cp -r teslabox-main/* teslabox
   rm -rf teslabox-main
   cd teslabox
   export NPM_CONFIG_UNSAFE_PERM=true
   npm install
   ```
14. Finalize the TeslaBox service:
  14.1. First, create the service file:
  ```
  nano /lib/systemd/system/teslabox.service
  ```

  14.2. Paste this, with each Environment variable appended with its =value (if needed):
  ```
  [Unit]
  Description=App
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

  # To enable remote access, enter these
  Environment="NGROK_AUTH_TOKEN="
  # Choose the region closest to you (us, eu, ap, au, sa, jp or in)
  Environment="NGROK_REGION=us"

  # To enable remote admin access, enter password
  Environment="ADMIN_PASSWORD="

  # To enable remote public (stream-only) access, enter password (this mustn't be the same as the admin password)
  Environment="PUBLIC_PASSWORD="

  # For paid Ngrok accounts, enter your custom domain ("you.example.com") or subdomain ("you" for you.ngrok.io)
  Environment="ADMIN_HOST="

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

  14.3. Install the service to start at every boot as follows:
  ```
  systemctl daemon-reload
  systemctl enable teslabox
  systemctl start teslabox
  systemctl status teslabox
  ```

  If the status is Green and shows active (running), continue to setup

## Setup

### Initial setup
1. Connect TeslaBox to your computer via USB cable and wait for it to appear as drive
2. Create an empty ```TeslaCam``` under the root folder of the drive
3. Make sure TeslaBox is connected to your home network via ethernet cable or home WiFi
4. Browse to the hostname from 4.1 to edit these settings:
- Car name (appears next to each notification)
- Log level (log verbosity. recommended: Debug)
- Archive (enables archiving)
- Archive seconds (the longer you set this, the more time and space each clip would take to process. recommended: 30)
- Archive quality (the higher you set this, the more space each clip would take. recommended: Lowest)
- Archive compression (the slower you set this, the less space each clip would take, but also the longer it take to process. recommended: Very fast)
- Archive days (events older than this will automatically get deleted locally. 0 or empty to disable. recommended: 30)
- Email recipients (comma seperated list of email addresses that should be notified)
- Telegram recipients (comma seperated list of Telegram Chat IDs that should be notified)
- Stream (enables streaming)
- Stream angles (comma seperated list of angles that should be streamed. possibly: front, right, back, left)
- SSH (enables remote shell access)
- Public (enables remote public streaming)

### In-car connectivity
TeslaBox works best with in-car WiFi. I personally use a 4G USB access point plugged into the main console with a short USB-A (female) to USB-C (male) cable. You can also use your mobile WiFi hotspot, or wait for the car to use your home WiFi as you park.

### Admin access
This works if you entered admin password. Settings are explained above under Initial setup. To logout, click the "Logout" icon at the bottom.

### Public access
This works if you entered public password. It will restrict public access to stream view only. To logout, click the "Logout" button at the top.

## Usage

### Dashcam
Tesla would recognize the TeslaBox as standard USB. You can click save, honk or use voice commands to capture dashcam clips as you would normally. Just make sure the TeslaBox is connected properly and the "Record/ing" has a Red dot on the car quick-settings screen.

If archive is enabled, clips will be uploaded to S3. If email and/or Telegram has been set up, you'll be notified there with a copy fo each clip (along with the event location).

The clip would start X seconds prior to the event ("red dot"). X is settable under *Admin > Archive seconds*.

### Sentry
If archive is enabled and sentry mode is activated, then similarly to dashcam every clip will be uploaded to S3 and/or notified.

The clip would start X/2 seconds prior to the event ("red dot") and X/2 seconds following the event. X is settable under *Admin > Archive seconds*.

If the event is sensed on the rear, then the back camera is enlarged, otherwise - front. The side cameras are always smaller.

### Raw footage
Dashcam and sentry videos are always available through the Dashcam app on your Tesla, or by connecting TeslaBox using USB cable to your computer.

### Stream
This is similar to Tesla's Sentry Mode Live Camera feature but works even on drive plus available on any browser. To some extent, you can use it as a public security camera.

There is, however, a 1 minute delay for each clip which is the time it takes to close and prepare the file. You can choose what angles to stream and switch between them. Video would automatically progress to the next minute when it is done playing.

If sentry mode is disabled or car is asleep, you may not see any new streams.

This feature is automatically disabled when the car goes to sleep or TeslaBox restarts.

## Important considerations
TeslaBox neither use any Tesla API nor requires any Tesla token. It only replaces your Tesla's standard USB or SSD drive with Micro-SD card on a Raspberry Pi.

You can delete individual (or all) videos under "Safety" or through the Dashcam app on your Tesla, but do **not** format the drive. It will render the TeslaBox useless.

There might be risks involved with running TeslaBox under certain tempature conditions, TeslaBox not recording dashcam or sentry videos and/or TeslaBox not uploading, delivering or notifying you of such events. Always make sure Tesla recognizes a valid USB storage, and that videos are saved and viewable through the built-in Dashcam app.

There might be AWS costs associated with archiving (both storing and viewing clips). See [S3 pricing](https://aws.amazon.com/s3/pricing/).

There might be 3G/4G bandwidth costs associated with your WiFi connectivity. If you are worried you can have TeslaBox connect only to your home or public WiFi.

## Upgrade

1. SSH to your Raspberry Pi
2. Perform the following as sudo using ```sudo -i```

   2.1. Download and re-install TeslaBox and packages:
   ```
   cd /root
   curl -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
   unzip -o main.zip
   cp -r teslabox-main/* teslabox
   rm -rf teslabox-main
   cd teslabox
   export NPM_CONFIG_UNSAFE_PERM=true
   npm install
   ```

   2.2. Restart TeslaBox service:
   ```
   systemctl restart teslabox
   ```

## Support
TeslaBox is not affiliated or supported by Tesla. There is no official support whatsoever. As per the license this is provided As-Is. **Use at your own risk!**

Please open an issue if things seems out of order and I'll attend them as time allows.

## Credits
TeslaBox wouldn't be possible without the help of [teslausb](https://github.com/marcone/teslausb), [tesla_dashcam](https://github.com/ehendrix23/tesla_dashcam) and friends at [TeslaFansIL](https://t.me/TeslaFansIL).
